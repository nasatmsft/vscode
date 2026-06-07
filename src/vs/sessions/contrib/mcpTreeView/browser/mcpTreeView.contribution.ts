/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, WindowEnablement } from '../../../../workbench/common/views.js';
import { IsSessionsWindowContext } from '../../../../workbench/common/contextkeys.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { McpCommandIds } from '../../../../workbench/contrib/mcp/common/mcpCommandIds.js';
import { ContributionEnablementState } from '../../../../workbench/contrib/chat/common/enablement.js';
import { IMcpService, McpConnectionState } from '../../../../workbench/contrib/mcp/common/mcpTypes.js';
import { IsPhoneLayoutContext } from '../../../common/contextkeys.js';
import { ISessionsMcpUserIntentService } from '../common/mcpUserIntentService.js';
import { SESSIONS_MCP_CATEGORY, SESSIONS_MCP_CONTAINER_ID, SESSIONS_MCP_VIEW_ID, SessionsMcpServerItemMenuId } from './mcpTreeView.js';
import { SessionsMcpServerEnabledContextKey, SessionsMcpServerStateContextKey, SessionsMcpViewPane } from './mcpTreeViewPane.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';

const mcpViewIcon = registerIcon('sessions-mcp-view-icon', Codicon.server, localize2('sessionsMcpViewIcon', 'View icon for the MCP Servers view in the Agents Window.').value);

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

const mcpViewContainer = viewContainersRegistry.registerViewContainer({
	id: SESSIONS_MCP_CONTAINER_ID,
	title: localize2('mcpServers', "MCP Servers"),
	icon: mcpViewIcon,
	order: 12,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [SESSIONS_MCP_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: SESSIONS_MCP_CONTAINER_ID,
	hideIfEmpty: false,
	openCommandActionDescriptor: {
		id: SESSIONS_MCP_CONTAINER_ID,
		title: localize2('mcpServers', "MCP Servers"),
		mnemonicTitle: localize({ key: 'miMcpServers', comment: ['&& denotes a mnemonic'] }, "&&MCP Servers"),
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM },
		order: 2,
	},
	windowEnablement: WindowEnablement.Sessions,
}, ViewContainerLocation.AuxiliaryBar);

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

viewsRegistry.registerViews([{
	id: SESSIONS_MCP_VIEW_ID,
	name: localize2('mcpServers', "MCP Servers"),
	containerIcon: mcpViewIcon,
	ctorDescriptor: new SyncDescriptor(SessionsMcpViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	when: IsPhoneLayoutContext.negate(),
	windowEnablement: WindowEnablement.Sessions,
}], mcpViewContainer);

//#region Helpers

type ServerContext = { serverId: string } | string | undefined;

function extractServerId(context: ServerContext): string | undefined {
	if (!context) {
		return undefined;
	}
	if (typeof context === 'string') {
		return context;
	}
	return context.serverId;
}

//#endregion

//#region View title actions (refresh / add)

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.refresh',
			title: localize2('refreshMcpServers', "Refresh"),
			icon: Codicon.refresh,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.equals('view', SESSIONS_MCP_VIEW_ID),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const mcpService = accessor.get(IMcpService);
		const viewsService = accessor.get(IViewsService);
		await mcpService.activateCollections();
		const view = viewsService.getViewWithId(SESSIONS_MCP_VIEW_ID);
		(view as SessionsMcpViewPane | undefined)?.refresh();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.addServer',
			title: localize2('addMcpServer', "Add MCP Server\u2026"),
			icon: Codicon.add,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 2,
				when: ContextKeyExpr.equals('view', SESSIONS_MCP_VIEW_ID),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand(McpCommandIds.AddConfiguration);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.browse',
			title: localize2('browseMcpServers', "Browse MCP Servers"),
			icon: Codicon.search,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 3,
				when: ContextKeyExpr.equals('view', SESSIONS_MCP_VIEW_ID),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand(McpCommandIds.Browse);
	}
});

//#endregion

//#region Per-server actions

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.startServer',
			title: localize2('startMcpServer', "Start Server"),
			icon: Codicon.debugStart,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		accessor.get(ISessionsMcpUserIntentService).markStarted(id);
		await accessor.get(ICommandService).executeCommand(McpCommandIds.StartServer, id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.stopServer',
			title: localize2('stopMcpServer', "Stop Server"),
			icon: Codicon.debugStop,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		accessor.get(ISessionsMcpUserIntentService).markStopped(id);
		await accessor.get(ICommandService).executeCommand(McpCommandIds.StopServer, id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.restartServer',
			title: localize2('restartMcpServer', "Restart Server"),
			icon: Codicon.debugRestart,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		accessor.get(ISessionsMcpUserIntentService).markStarted(id);
		await accessor.get(ICommandService).executeCommand(McpCommandIds.RestartServer, id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.showOutput',
			title: localize2('showMcpServerOutput', "Show Output"),
			icon: Codicon.output,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		await accessor.get(ICommandService).executeCommand(McpCommandIds.ShowOutput, id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.showConfiguration',
			title: localize2('showMcpServerConfiguration', "Show Configuration"),
			icon: Codicon.gear,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		const server = accessor.get(IMcpService).servers.get().find(s => s.definition.id === id);
		if (!server) { return; }
		await accessor.get(ICommandService).executeCommand(McpCommandIds.ShowConfiguration, server.collection.id, server.definition.id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.disableServer',
			title: localize2('disableMcpServer', "Disable"),
			icon: Codicon.eyeClosed,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		const mcpService = accessor.get(IMcpService);
		const server = mcpService.servers.get().find(s => s.definition.id === id);
		if (!server) { return; }
		accessor.get(ISessionsMcpUserIntentService).markStopped(id);
		await server.stop();
		mcpService.enablementModel.setEnabled(id, ContributionEnablementState.DisabledWorkspace);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.enableServer',
			title: localize2('enableMcpServer', "Enable"),
			icon: Codicon.eye,
		});
	}
	async run(accessor: ServicesAccessor, context: ServerContext): Promise<void> {
		const id = extractServerId(context);
		if (!id) { return; }
		accessor.get(IMcpService).enablementModel.setEnabled(id, ContributionEnablementState.EnabledWorkspace);
	}
});

//#endregion

//#region Menu wiring

// State-derived when clauses. The renderer/onContextMenu populates these context keys.
const runningState = ContextKeyExpr.equals(SessionsMcpServerStateContextKey.key, McpConnectionState.Kind.Running.toString());
const startingState = ContextKeyExpr.equals(SessionsMcpServerStateContextKey.key, McpConnectionState.Kind.Starting.toString());
const isEnabled = ContextKeyExpr.equals(SessionsMcpServerEnabledContextKey.key, true);
const isDisabled = ContextKeyExpr.equals(SessionsMcpServerEnabledContextKey.key, false);
const canStart = ContextKeyExpr.and(isEnabled, runningState.negate(), startingState.negate());
const canStop = ContextKeyExpr.and(isEnabled, ContextKeyExpr.or(runningState, startingState));

// Inline actions (icons shown when hovering a server row).
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.startServer', title: localize('startMcpServer', "Start Server"), icon: Codicon.debugStart },
	group: 'inline',
	order: 1,
	when: canStart,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.stopServer', title: localize('stopMcpServer', "Stop Server"), icon: Codicon.debugStop },
	group: 'inline',
	order: 1,
	when: canStop,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.restartServer', title: localize('restartMcpServer', "Restart Server"), icon: Codicon.debugRestart },
	group: 'inline',
	order: 2,
	when: ContextKeyExpr.and(isEnabled, ContextKeyExpr.or(runningState, startingState)),
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.showConfiguration', title: localize('showMcpServerConfiguration', "Show Configuration"), icon: Codicon.gear },
	group: 'inline',
	order: 3,
});

// Context menu (right-click).
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.startServer', title: localize('startMcpServer', "Start Server") },
	group: '1_lifecycle',
	order: 1,
	when: canStart,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.stopServer', title: localize('stopMcpServer', "Stop Server") },
	group: '1_lifecycle',
	order: 2,
	when: canStop,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.restartServer', title: localize('restartMcpServer', "Restart Server") },
	group: '1_lifecycle',
	order: 3,
	when: isEnabled,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.showOutput', title: localize('showMcpServerOutput', "Show Output") },
	group: '2_info',
	order: 1,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.showConfiguration', title: localize('showMcpServerConfiguration', "Show Configuration") },
	group: '2_info',
	order: 2,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.disableServer', title: localize('disableMcpServer', "Disable") },
	group: '3_toggle',
	order: 1,
	when: isEnabled,
});
MenuRegistry.appendMenuItem(SessionsMcpServerItemMenuId, {
	command: { id: 'sessions.mcp.enableServer', title: localize('enableMcpServer', "Enable") },
	group: '3_toggle',
	order: 1,
	when: isDisabled,
});

//#endregion

//#region Focus action (Cmd/Ctrl+Shift+M from the Agents window)

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'sessions.mcp.focusView',
			title: localize2('focusMcpView', "Focus MCP Servers"),
			category: SESSIONS_MCP_CATEGORY,
			precondition: IsSessionsWindowContext,
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openView(SESSIONS_MCP_VIEW_ID, true);
	}
});

//#endregion

//#region Auto-restart workbench contribution

/**
 * Forces {@link ISessionsMcpUserIntentService} to be instantiated at workbench
 * startup so its observers on the {@link IMcpService} are wired up before any
 * session switch happens. Without this, the service is registered but never
 * created (singleton instantiation is lazy), so the auto-restart never fires.
 */
class SessionsMcpAutoStarter extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.mcp.autoStarter';

	constructor(@ISessionsMcpUserIntentService _userIntentService: ISessionsMcpUserIntentService) {
		super();
	}
}

registerWorkbenchContribution2(SessionsMcpAutoStarter.ID, SessionsMcpAutoStarter, WorkbenchPhase.AfterRestored);

//#endregion
