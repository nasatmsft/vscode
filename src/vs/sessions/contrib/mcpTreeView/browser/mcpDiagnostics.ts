/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Extensions, IOutputChannelRegistry, IOutputService } from '../../../../workbench/services/output/common/output.js';
import { IMcpRegistry } from '../../../../workbench/contrib/mcp/common/mcpRegistryTypes.js';
import { IMcpServer, IMcpService, McpCollectionDefinition, McpConnectionState, McpServerDefinition, McpServerLaunch, McpServerTransportType } from '../../../../workbench/contrib/mcp/common/mcpTypes.js';
import { MCP } from '../../../../workbench/contrib/mcp/common/modelContextProtocol.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { ISession, ISessionWorkspace } from '../../../services/sessions/common/session.js';
import { ISessionsMcpUserIntentService } from '../common/mcpUserIntentService.js';
import { SESSIONS_MCP_VIEW_ID, SessionsMcpGroupByMenuId, SessionsMcpServerItemMenuId, SessionsMcpToolItemMenuId, SessionsMcpTreeContextMenuId } from './mcpTreeView.js';

const MCP_DIAGNOSTICS_OUTPUT_CHANNEL_ID = 'sessions.mcp.diagnostics';
const INSPECT_MCP_SERVERS_COMMAND_ID = 'sessions.mcp.inspectServers';
const COPY_MCP_DIAGNOSTICS_COMMAND_ID = 'sessions.mcp.copyDiagnostics';
const INSPECT_MCP_SERVER_COMMAND_ID = 'sessions.mcp.inspectServer';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
	readonly [key: string]: JsonValue;
}

interface ServerContext {
	readonly serverId?: string;
}

Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).registerChannel({
	id: MCP_DIAGNOSTICS_OUTPUT_CHANNEL_ID,
	label: localize('mcpDiagnosticsOutput', "MCP Diagnostics"),
	log: false,
	languageId: 'json',
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: INSPECT_MCP_SERVERS_COMMAND_ID,
			title: localize2('inspectMcpServers', "Inspect MCP Servers"),
			category: localize2('mcpServersCategory', "MCP Servers"),
			icon: Codicon.inspect,
			f1: true,
			menu: {
				id: MenuId.ViewTitle,
				group: '2_diagnostics',
				order: 1,
				when: ContextKeyExpr.equals('view', SESSIONS_MCP_VIEW_ID),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showDiagnostics(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: COPY_MCP_DIAGNOSTICS_COMMAND_ID,
			title: localize2('copyMcpDiagnostics', "Copy MCP Diagnostics"),
			category: localize2('mcpServersCategory', "MCP Servers"),
			icon: Codicon.copy,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const clipboardService = accessor.get(IClipboardService);
		await clipboardService.writeText(buildDiagnosticsString(accessor));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: INSPECT_MCP_SERVER_COMMAND_ID,
			title: localize2('inspectMcpServer', "Inspect Server"),
			icon: Codicon.inspect,
		});
	}

	async run(accessor: ServicesAccessor, context?: ServerContext | string): Promise<void> {
		const serverId = typeof context === 'string' ? context : context?.serverId;
		await showDiagnostics(accessor, serverId);
	}
});

MenuRegistry.appendMenuItem(SessionsMcpTreeContextMenuId, {
	command: { id: INSPECT_MCP_SERVERS_COMMAND_ID, title: localize('inspectMcpServers', "Inspect MCP Servers"), icon: Codicon.inspect },
	group: '5_diagnostics',
	order: 1,
});

MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: INSPECT_MCP_SERVER_COMMAND_ID, title: localize('inspectMcpServer', "Inspect Server"), icon: Codicon.inspect },
	group: '5_diagnostics',
	order: 1,
});

MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: INSPECT_MCP_SERVERS_COMMAND_ID, title: localize('inspectAllMcpServers', "Inspect All MCP Servers") },
	group: '5_diagnostics',
	order: 2,
});

MenuRegistry.appendMenuItem(SessionsMcpToolItemMenuId, {
	command: { id: INSPECT_MCP_SERVER_COMMAND_ID, title: localize('inspectMcpServer', "Inspect Server"), icon: Codicon.inspect },
	group: '2_diagnostics',
	order: 1,
});

MenuRegistry.appendMenuItem(SessionsMcpGroupByMenuId, {
	command: { id: COPY_MCP_DIAGNOSTICS_COMMAND_ID, title: localize('copyMcpDiagnostics', "Copy MCP Diagnostics") },
	group: '9_diagnostics',
	order: 1,
});

async function showDiagnostics(accessor: ServicesAccessor, serverId?: string): Promise<void> {
	const outputService = accessor.get(IOutputService);
	const channel = outputService.getChannel(MCP_DIAGNOSTICS_OUTPUT_CHANNEL_ID);
	if (!channel) {
		return;
	}
	channel.replace(buildDiagnosticsString(accessor, serverId));
	await outputService.showChannel(MCP_DIAGNOSTICS_OUTPUT_CHANNEL_ID);
}

function buildDiagnosticsString(accessor: ServicesAccessor, serverId?: string): string {
	return JSON.stringify(buildDiagnostics(accessor, serverId), undefined, '\t');
}

function buildDiagnostics(accessor: ServicesAccessor, serverId?: string): JsonObject {
	const mcpService = accessor.get(IMcpService);
	const mcpRegistry = accessor.get(IMcpRegistry);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const sessionsManagementService = accessor.get(ISessionsManagementService);
	const userIntentService = accessor.get(ISessionsMcpUserIntentService);
	const servers = mcpService.servers.get();
	const inspectedServers = serverId ? servers.filter(server => server.definition.id === serverId) : servers;
	const serverSummaries = inspectedServers.map(server => describeServer(server, userIntentService));

	return {
		timestamp: new Date().toISOString(),
		filter: serverId ? { serverId } : null,
		currentWorkspace: {
			folders: workspaceContextService.getWorkspace().folders.map(folder => ({
				uri: folder.uri.toString(),
				name: folder.name,
				index: folder.index,
			})),
		},
		registry: {
			lazyCollectionState: describeLazyCollectionState(mcpRegistry.lazyCollectionState.get()),
			collections: mcpRegistry.collections.get().map(describeCollection),
		},
		mcpRuntime: {
			serverCount: servers.length,
			servers: serverSummaries,
		},
		sessions: sessionsManagementService.getSessions().map(session => describeSession(session, serverSummaries)),
		activeSession: describeActiveSession(sessionsManagementService.activeSession.get()),
	};
}

function describeServer(server: IMcpServer, userIntentService: ISessionsMcpUserIntentService): JsonObject {
	const definitions = server.readDefinitions().get();
	const connection = server.connection.get();
	const handler = connection?.handler.get();
	const tools = server.tools.get();
	const prompts = server.prompts.get();
	const metadata = server.serverMetadata.get();

	return {
		id: server.definition.id,
		label: server.definition.label,
		collectionRef: {
			id: server.collection.id,
			label: server.collection.label,
		},
		fullDefinition: definitions.server ? describeDefinition(definitions.server) : null,
		fullCollection: definitions.collection ? describeCollection(definitions.collection) : null,
		runtime: {
			connectionState: describeConnectionState(server.connectionState.get()),
			enablement: server.enablement.get(),
			cacheState: server.cacheState.get(),
			userStartedIntent: userIntentService.isUserStarted(server.definition.id),
			metadata: metadata ? {
				serverName: metadata.serverName ?? null,
				serverInstructions: metadata.serverInstructions ?? null,
				hasIcon: !!metadata.icons.getUrl(16),
			} : null,
			tools: tools.map(tool => ({
				id: tool.id,
				name: tool.definition.name,
				description: tool.definition.description ?? null,
			})),
			prompts: prompts.map(prompt => ({
				id: prompt.id,
				name: prompt.name,
				title: prompt.title ?? null,
				description: prompt.description ?? null,
			})),
			capabilities: server.capabilities.get() ?? null,
			connection: connection ? {
				state: describeConnectionState(connection.state.get()),
				definition: describeDefinition(connection.definition),
				launchDefinition: describeLaunch(connection.launchDefinition),
				handler: handler ? {
					serverInfo: {
						name: handler.serverInfo.name,
						version: handler.serverInfo.version ?? null,
					},
					serverInstructions: handler.serverInstructions ?? null,
					capabilities: describeCapabilities(handler.capabilities),
				} : null,
			} : null,
		},
	};
}

function describeDefinition(definition: McpServerDefinition): JsonObject {
	return {
		id: definition.id,
		label: definition.label,
		launch: describeLaunch(definition.launch),
		roots: definition.roots?.map(uri => uri.toString()) ?? null,
		cacheNonce: definition.cacheNonce,
		devMode: !!definition.devMode,
		sandboxEnabled: definition.sandboxEnabled ?? null,
		hasStaticMetadata: !!definition.staticMetadata,
		staticMetadata: definition.staticMetadata ? {
			toolCount: definition.staticMetadata.tools?.length ?? 0,
			capabilities: definition.staticMetadata.capabilities ? true : false,
			hasInstructions: !!definition.staticMetadata.instructions,
			serverInfo: definition.staticMetadata.serverInfo ? {
				name: definition.staticMetadata.serverInfo.name,
				version: definition.staticMetadata.serverInfo.version ?? null,
			} : null,
		} : null,
		presentation: definition.presentation ? {
			order: definition.presentation.order ?? null,
			origin: definition.presentation.origin ? {
				uri: definition.presentation.origin.uri.toString(),
				range: definition.presentation.origin.range ? {
					startLineNumber: definition.presentation.origin.range.startLineNumber,
					startColumn: definition.presentation.origin.range.startColumn,
					endLineNumber: definition.presentation.origin.range.endLineNumber,
					endColumn: definition.presentation.origin.range.endColumn,
				} : null,
			} : null,
		} : null,
	};
}

function describeLaunch(launch: McpServerLaunch): JsonObject {
	switch (launch.type) {
		case McpServerTransportType.HTTP:
			return {
				type: 'http',
				uri: launch.uri.toString(),
				headers: launch.headers.map(([name]) => [name, '<redacted>']),
				oauth: launch.oauth ? {
					hasClientId: !!launch.oauth.clientId,
					enterpriseManaged: launch.oauth.enterpriseManaged ?? false,
				} : null,
				authentication: launch.authentication ? {
					providerId: launch.authentication.providerId,
					scopeCount: launch.authentication.scopes.length,
				} : null,
			};
		case McpServerTransportType.Stdio:
			return {
				type: 'stdio',
				command: launch.command,
				args: [...launch.args],
				cwd: launch.cwd ?? null,
				env: Object.fromEntries(Object.keys(launch.env).sort().map(key => [key, '<redacted>'])),
				envFile: launch.envFile ? '<redacted>' : null,
				sandbox: launch.sandbox ? true : false,
			};
	}
}

function describeCollection(collection: McpCollectionDefinition): JsonObject {
	return {
		id: collection.id,
		label: collection.label,
		remoteAuthority: collection.remoteAuthority ?? null,
		scope: collection.scope,
		configTarget: collection.configTarget,
		order: collection.order,
		trustBehavior: collection.trustBehavior,
		hasLazy: !!collection.lazy,
		source: describeCollectionSource(collection.source),
		presentation: collection.presentation?.origin ? {
			origin: collection.presentation.origin.toString(),
		} : null,
		serverDefinitions: collection.serverDefinitions.get().map(definition => ({
			id: definition.id,
			label: definition.label,
			launchType: definition.launch.type === McpServerTransportType.HTTP ? 'http' : 'stdio',
			roots: definition.roots?.map(uri => uri.toString()) ?? null,
			cacheNonce: definition.cacheNonce,
		})),
	};
}

function describeCollectionSource(source: McpCollectionDefinition['source']): JsonValue {
	if (!source) {
		return null;
	}
	if (source instanceof ExtensionIdentifier) {
		return { extensionId: source.value };
	}
	return {
		id: source.id,
		name: source.name,
		label: source.label,
		description: source.description,
	};
}

function describeConnectionState(state: McpConnectionState): JsonObject {
	if (state.state === McpConnectionState.Kind.Error) {
		return {
			kind: McpConnectionState.toKindString(state.state),
			message: state.message,
			code: state.code ?? null,
			shouldRetry: state.shouldRetry ?? null,
		};
	}
	if (state.state === McpConnectionState.Kind.Stopped) {
		return {
			kind: McpConnectionState.toKindString(state.state),
			reason: state.reason ?? null,
		};
	}
	return { kind: McpConnectionState.toKindString(state.state) };
}

function describeCapabilities(capabilities: MCP.ServerCapabilities): JsonObject {
	return {
		hasTools: !!capabilities.tools,
		hasPrompts: !!capabilities.prompts,
		hasResources: !!capabilities.resources,
		hasLogging: !!capabilities.logging,
		hasCompletions: !!capabilities.completions,
	};
}

function describeLazyCollectionState(state: ReturnType<IMcpRegistry['lazyCollectionState']['get']>): JsonObject {
	return {
		state: state.state,
		collections: state.collections.map(collection => ({
			id: collection.id,
			label: collection.label,
		})),
	};
}

function describeSession(session: ISession, servers: readonly JsonObject[]): JsonObject {
	const workspace = session.workspace.get();
	return {
		sessionId: session.sessionId,
		resource: session.resource.toString(),
		providerId: session.providerId,
		sessionType: session.sessionType,
		title: session.title.get(),
		status: session.status.get(),
		workspace: workspace ? describeSessionWorkspace(workspace) : null,
		mcp: {
			matchingServers: workspace ? getMatchingServersForWorkspace(workspace, servers) : [],
		},
	};
}

function describeActiveSession(session: ISession | undefined): JsonValue {
	if (!session) {
		return null;
	}
	return {
		sessionId: session.sessionId,
		title: session.title.get(),
		providerId: session.providerId,
		sessionType: session.sessionType,
	};
}

function describeSessionWorkspace(workspace: ISessionWorkspace): JsonObject {
	return {
		uri: workspace.uri.toString(),
		label: workspace.label,
		description: workspace.description ?? null,
		group: workspace.group ?? null,
		requiresWorkspaceTrust: workspace.requiresWorkspaceTrust,
		isVirtualWorkspace: workspace.isVirtualWorkspace,
		folders: workspace.folders.map(folder => ({
			root: folder.root.toString(),
			workingDirectory: folder.workingDirectory.toString(),
			name: folder.name,
			description: folder.description ?? null,
			gitRepository: folder.gitRepository ? {
				uri: folder.gitRepository.uri.toString(),
				workTreeUri: folder.gitRepository.workTreeUri?.toString() ?? null,
				branchName: folder.gitRepository.branchName ?? null,
				baseBranchName: folder.gitRepository.baseBranchName ?? null,
			} : null,
		})),
	};
}

function getMatchingServersForWorkspace(workspace: ISessionWorkspace, servers: readonly JsonObject[]): JsonValue[] {
	const folderUris = new Set<string>();
	for (const folder of workspace.folders) {
		folderUris.add(folder.root.toString());
		folderUris.add(folder.workingDirectory.toString());
	}

	const matches: JsonValue[] = [];
	for (const server of servers) {
		const definition = server.fullDefinition;
		if (!definition || Array.isArray(definition) || typeof definition !== 'object') {
			continue;
		}
		const roots = definition.roots;
		if (!Array.isArray(roots)) {
			matches.push({
				serverId: server.id,
				label: server.label,
				reason: 'no explicit roots',
			});
			continue;
		}
		if (roots.some(root => typeof root === 'string' && folderUris.has(root))) {
			matches.push({
				serverId: server.id,
				label: server.label,
				reason: 'matching root',
			});
		}
	}
	return matches;
}
