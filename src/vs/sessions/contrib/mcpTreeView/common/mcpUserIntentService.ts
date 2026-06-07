/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Tracks which MCP servers the user has explicitly started via the Agents
 * Window's MCP Servers tree view, so we can auto-resume them when the active
 * session switches (which can cause the core {@link IMcpService} to stop
 * workspace-scoped servers whose definitions changed).
 *
 * State is persisted to profile storage so it spans session switches and
 * window reloads.
 */
export interface ISessionsMcpUserIntentService {
	readonly _serviceBrand: undefined;

	/** Event fired when the set of tracked server ids changes. */
	readonly onDidChange: Event<void>;

	/** True if the user has explicitly asked this server to be running. */
	isUserStarted(serverId: string): boolean;

	/** Mark the server as user-started (and persist). */
	markStarted(serverId: string): void;

	/** Forget the user-start intent for the server (and persist). */
	markStopped(serverId: string): void;
}

export const ISessionsMcpUserIntentService = createDecorator<ISessionsMcpUserIntentService>('sessionsMcpUserIntentService');
