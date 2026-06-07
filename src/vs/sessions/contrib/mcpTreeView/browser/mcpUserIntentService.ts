/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { isContributionEnabled } from '../../../../workbench/contrib/chat/common/enablement.js';
import { IMcpServer, IMcpService, McpConnectionState } from '../../../../workbench/contrib/mcp/common/mcpTypes.js';
import { ISessionsMcpUserIntentService } from '../common/mcpUserIntentService.js';

const STORAGE_KEY = 'sessions.mcp.userStartedServers';

/**
 * Implementation of {@link ISessionsMcpUserIntentService}. Persists the set
 * of "user wants this running" server ids to profile storage and listens to
 * the {@link IMcpService} so that any tracked server that ends up Stopped
 * (e.g. because the active session/workspace folder changed and the core
 * {@link McpService} stopped it because its definition changed) is
 * automatically (re)started.
 *
 * The core {@link McpService} reuses the same {@link IMcpServer} instance
 * across session switches — it just calls `.stop()` on it when the server
 * definition changes. We therefore watch the server's connection state and
 * auto-start only when it is stopped and no previous auto-start is in flight.
 */
export class SessionsMcpUserIntentService extends Disposable implements ISessionsMcpUserIntentService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _ids = new Set<string>();
	private readonly _inFlight = new Set<string>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IMcpService private readonly mcpService: IMcpService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._load();

		// Observe every server's connectionState/enablement; whenever one
		// settles into Stopped we attempt a restart if it's a user-tracked id.
		this._register(autorun(reader => {
			const servers = this.mcpService.servers.read(reader);
			for (const server of servers) {
				const state = server.connectionState.read(reader).state;
				server.enablement.read(reader);
				if (state === McpConnectionState.Kind.Stopped) {
					this._maybeRestart(server);
				}
			}
		}));

		// React to external storage updates (e.g. another window in the same profile).
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, STORAGE_KEY, this._store)(() => {
			this._load();
			this._onDidChange.fire();
			for (const server of this.mcpService.servers.get()) {
				if (server.connectionState.get().state === McpConnectionState.Kind.Stopped) {
					this._maybeRestart(server);
				}
			}
		}));
	}

	isUserStarted(serverId: string): boolean {
		return this._ids.has(serverId);
	}

	markStarted(serverId: string): void {
		if (this._ids.has(serverId)) {
			return;
		}
		this._ids.add(serverId);
		this._save();
		this._onDidChange.fire();
	}

	markStopped(serverId: string): void {
		if (!this._ids.delete(serverId)) {
			return;
		}
		this._save();
		this._onDidChange.fire();
	}

	private _load(): void {
		this._ids.clear();
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.PROFILE, '[]');
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (const id of parsed) {
					if (typeof id === 'string') {
						this._ids.add(id);
					}
				}
			}
		} catch (err) {
			this.logService.warn('[SessionsMcpUserIntentService] failed to parse stored user-start set:', err);
		}
	}

	private _save(): void {
		this.storageService.store(STORAGE_KEY, JSON.stringify([...this._ids]), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private _maybeRestart(server: IMcpServer): void {
		const id = server.definition.id;
		if (!this._ids.has(id)) {
			return;
		}
		if (this._inFlight.has(id)) {
			return;
		}
		if (!isContributionEnabled(server.enablement.get())) {
			return;
		}
		this._inFlight.add(id);
		this.logService.debug(`[SessionsMcpUserIntentService] auto-restarting MCP server ${id}`);
		server.start({ promptType: 'never' }).then(
			() => { this._inFlight.delete(id); },
			err => {
				this._inFlight.delete(id);
				this.logService.warn(`[SessionsMcpUserIntentService] failed to auto-restart MCP server ${id}:`, err);
			},
		);
	}
}

registerSingleton(ISessionsMcpUserIntentService, SessionsMcpUserIntentService, InstantiationType.Delayed);
