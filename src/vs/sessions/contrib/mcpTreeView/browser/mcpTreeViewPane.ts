/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/mcpTreeView.css';
import * as dom from '../../../../base/browser/dom.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IAsyncDataSource, ITreeContextMenuEvent, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { createActionViewItem, getContextMenuActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { ContributionEnablementState, isContributionEnabled } from '../../../../workbench/contrib/chat/common/enablement.js';
import { IMcpServer, IMcpService, IMcpTool, McpConnectionState } from '../../../../workbench/contrib/mcp/common/mcpTypes.js';
import { SessionsMcpServerItemMenuId, SessionsMcpToolItemMenuId } from './mcpTreeView.js';

//#region Context Keys

export const SessionsMcpIsEmptyContextKey = new RawContextKey<boolean>('sessionsMcp.isEmpty', true);
export const SessionsMcpServerStateContextKey = new RawContextKey<string>('sessionsMcpServerState', '');
export const SessionsMcpServerEnabledContextKey = new RawContextKey<boolean>('sessionsMcpServerEnabled', true);

//#endregion

//#region Tree item types

const ROOT_ELEMENT = Symbol('mcp-root');
type RootElement = typeof ROOT_ELEMENT;

interface IMcpServerTreeItem {
	readonly type: 'server';
	readonly id: string;
	readonly server: IMcpServer;
}

interface IMcpToolTreeItem {
	readonly type: 'tool';
	readonly id: string;
	readonly server: IMcpServer;
	readonly tool: IMcpTool;
}

type McpTreeItem = IMcpServerTreeItem | IMcpToolTreeItem;

//#endregion

//#region Tree delegate / renderers

class McpTreeDelegate implements IListVirtualDelegate<McpTreeItem> {
	getHeight(_element: McpTreeItem): number {
		return 22;
	}

	getTemplateId(element: McpTreeItem): string {
		return element.type;
	}
}

interface ITreeItemTemplateData {
	readonly container: HTMLElement;
	readonly statusDot: HTMLElement;
	readonly icon: HTMLElement;
	readonly name: HTMLElement;
	readonly description: HTMLElement;
	readonly actionBar: ActionBar;
	readonly elementDisposables: DisposableStore;
	readonly templateDisposables: DisposableStore;
}

abstract class BaseMcpRenderer<T extends McpTreeItem> implements ITreeRenderer<T, FuzzyScore, ITreeItemTemplateData> {
	abstract readonly templateId: string;

	constructor(
		@IMenuService protected readonly menuService: IMenuService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
	) { }

	renderTemplate(container: HTMLElement): ITreeItemTemplateData {
		const element = dom.append(container, dom.$('.sessions-mcp-tree-item'));
		const statusDot = dom.append(element, dom.$('.status-dot'));
		const icon = dom.append(element, dom.$('.icon'));
		const name = dom.append(element, dom.$('.name'));
		const description = dom.append(element, dom.$('.description'));
		const actionsContainer = dom.append(element, dom.$('.actions'));

		const templateDisposables = new DisposableStore();
		const actionBar = templateDisposables.add(new ActionBar(actionsContainer, {
			actionViewItemProvider: createActionViewItem.bind(undefined, this.instantiationService),
		}));

		return {
			container: element,
			statusDot,
			icon,
			name,
			description,
			actionBar,
			elementDisposables: new DisposableStore(),
			templateDisposables,
		};
	}

	abstract renderElement(node: ITreeNode<T, FuzzyScore>, index: number, templateData: ITreeItemTemplateData): void;

	disposeElement(_node: ITreeNode<T, FuzzyScore>, _index: number, templateData: ITreeItemTemplateData): void {
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: ITreeItemTemplateData): void {
		templateData.templateDisposables.dispose();
		templateData.elementDisposables.dispose();
	}
}

class McpServerRenderer extends BaseMcpRenderer<IMcpServerTreeItem> {
	readonly templateId = 'server';

	renderElement(node: ITreeNode<IMcpServerTreeItem, FuzzyScore>, _index: number, templateData: ITreeItemTemplateData): void {
		const item = node.element;
		templateData.elementDisposables.clear();

		const update = () => {
			const state = item.server.connectionState.get().state;
			const enabled = isContributionEnabled(item.server.enablement.get());

			templateData.statusDot.className = 'status-dot ' + connectionStateToClass(state);
			templateData.statusDot.title = stateLabel(state, enabled);

			templateData.icon.className = 'icon';
			templateData.icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.server));

			templateData.name.textContent = item.server.definition.label;

			const toolCount = item.server.tools.get().length;
			templateData.description.textContent = toolCount > 0
				? localize('toolCount', "{0} tools", toolCount)
				: '';

			templateData.container.classList.toggle('disabled', !enabled);
			templateData.container.title = localize(
				'serverTooltip',
				"{0} \u2014 {1}",
				item.server.definition.label,
				stateLabel(state, enabled),
			);

			updateActions();
		};

		const context = { serverId: item.server.definition.id };

		const overlay = this.contextKeyService.createOverlay([
			[SessionsMcpServerStateContextKey.key, item.server.connectionState.get().state.toString()],
			[SessionsMcpServerEnabledContextKey.key, isContributionEnabled(item.server.enablement.get())],
		]);
		const menu = templateData.elementDisposables.add(this.menuService.createMenu(SessionsMcpServerItemMenuId, overlay));

		const updateActions = () => {
			const actions = menu.getActions({ arg: context, shouldForwardArgs: true });
			const { primary } = getContextMenuActions(actions, 'inline');
			templateData.actionBar.clear();
			templateData.actionBar.push(primary, { icon: true, label: false });
		};

		templateData.actionBar.context = context;

		templateData.elementDisposables.add(autorun(reader => {
			item.server.connectionState.read(reader);
			item.server.enablement.read(reader);
			item.server.tools.read(reader);
			update();
		}));

		templateData.elementDisposables.add(menu.onDidChange(updateActions));
	}
}

class McpToolRenderer extends BaseMcpRenderer<IMcpToolTreeItem> {
	readonly templateId = 'tool';

	renderElement(node: ITreeNode<IMcpToolTreeItem, FuzzyScore>, _index: number, templateData: ITreeItemTemplateData): void {
		const item = node.element;
		templateData.elementDisposables.clear();

		templateData.statusDot.className = 'status-dot';
		templateData.statusDot.style.visibility = 'hidden';

		templateData.icon.className = 'icon';
		templateData.icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.tools));

		templateData.name.textContent = item.tool.definition.name;

		const desc = item.tool.definition.description || '';
		templateData.description.textContent = desc;
		templateData.container.title = desc
			? `${item.tool.definition.name} \u2014 ${desc}`
			: item.tool.definition.name;

		const context = { serverId: item.server.definition.id, toolId: item.tool.id };
		templateData.actionBar.clear();
		templateData.actionBar.context = context;
	}
}

//#endregion

//#region Data source

class McpDataSource implements IAsyncDataSource<RootElement, McpTreeItem> {
	constructor(
		private readonly mcpService: IMcpService,
		private readonly onCountChanged: (count: number) => void,
	) { }

	hasChildren(element: RootElement | McpTreeItem): boolean {
		if (element === ROOT_ELEMENT) {
			return true;
		}
		if (element.type === 'server') {
			return element.server.tools.get().length > 0;
		}
		return false;
	}

	async getChildren(element: RootElement | McpTreeItem): Promise<McpTreeItem[]> {
		if (element === ROOT_ELEMENT) {
			const servers = [...this.mcpService.servers.get()]
				.sort((a, b) => a.definition.label.localeCompare(b.definition.label));
			this.onCountChanged(servers.length);
			return servers.map<IMcpServerTreeItem>(server => ({
				type: 'server',
				id: `server:${server.definition.id}`,
				server,
			}));
		}

		if (element.type === 'server') {
			const tools = [...element.server.tools.get()]
				.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
			return tools.map<IMcpToolTreeItem>(tool => ({
				type: 'tool',
				id: `tool:${element.server.definition.id}:${tool.id}`,
				server: element.server,
				tool,
			}));
		}

		return [];
	}
}

//#endregion

//#region View pane

export class SessionsMcpViewPane extends ViewPane {

	private tree: WorkbenchAsyncDataTree<RootElement, McpTreeItem, FuzzyScore> | undefined;
	private dataSource: McpDataSource | undefined;
	private treeContainer: HTMLElement | undefined;
	private readonly treeDisposables = this._register(new DisposableStore());

	private readonly isEmptyContextKey: IContextKey<boolean>;
	private readonly serverStateContextKey: IContextKey<string>;
	private readonly serverEnabledContextKey: IContextKey<boolean>;

	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => this.doRefresh(), 100));

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMcpService private readonly mcpService: IMcpService,
		@IMenuService private readonly menuService: IMenuService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this.isEmptyContextKey = SessionsMcpIsEmptyContextKey.bindTo(contextKeyService);
		this.serverStateContextKey = SessionsMcpServerStateContextKey.bindTo(contextKeyService);
		this.serverEnabledContextKey = SessionsMcpServerEnabledContextKey.bindTo(contextKeyService);

		// Auto-refresh tree shape when the set of servers, their tools, or
		// their connection states change. Throttle to avoid thrashing.
		this._register(autorun(reader => {
			const servers = this.mcpService.servers.read(reader);
			for (const server of servers) {
				server.connectionState.read(reader);
				server.tools.read(reader);
				server.enablement.read(reader);
			}
			this.refreshScheduler.schedule();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('sessions-mcp-view');
		this.treeContainer = dom.append(container, dom.$('.tree-container'));

		this.createTree();
	}

	private createTree(): void {
		if (!this.treeContainer) {
			return;
		}

		this.dataSource = new McpDataSource(
			this.mcpService,
			count => this.isEmptyContextKey.set(count === 0),
		);

		this.tree = this.treeDisposables.add(this.instantiationService.createInstance(
			WorkbenchAsyncDataTree<RootElement, McpTreeItem, FuzzyScore>,
			'SessionsMcpServers',
			this.treeContainer,
			new McpTreeDelegate(),
			[
				this.instantiationService.createInstance(McpServerRenderer),
				this.instantiationService.createInstance(McpToolRenderer),
			],
			this.dataSource,
			{
				identityProvider: {
					getId: (element: McpTreeItem) => element.id,
				},
				accessibilityProvider: {
					getAriaLabel: (element: McpTreeItem) => {
						if (element.type === 'server') {
							const state = element.server.connectionState.get().state;
							return localize('serverAria', "{0}, MCP server, {1}", element.server.definition.label, stateLabel(state, isContributionEnabled(element.server.enablement.get())));
						}
						return localize('toolAria', "{0}, tool", element.tool.definition.name);
					},
					getWidgetAriaLabel: () => localize('mcpTree', "MCP Servers"),
				},
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (element: McpTreeItem) => {
						return element.type === 'server' ? element.server.definition.label : element.tool.definition.name;
					},
				},
			}
		));

		this.treeDisposables.add(this.tree.onDidOpen(async e => {
			if (e.element?.type === 'server') {
				await e.element.server.showOutput(true);
			}
		}));

		this.treeDisposables.add(this.tree.onContextMenu(e => this.onContextMenu(e)));

		void this.tree.setInput(ROOT_ELEMENT);
	}

	private doRefresh(): void {
		if (!this.tree || !this.dataSource) {
			return;
		}
		void this.tree.updateChildren(ROOT_ELEMENT, true, true);
	}

	public refresh(): void {
		this.doRefresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree?.layout(height, width);
	}

	private onContextMenu(e: ITreeContextMenuEvent<McpTreeItem | null>): void {
		if (!e.element) {
			return;
		}

		if (e.element.type === 'server') {
			const server = e.element.server;
			const state = server.connectionState.get().state;
			const enabled = isContributionEnabled(server.enablement.get());

			this.serverStateContextKey.set(state.toString());
			this.serverEnabledContextKey.set(enabled);

			const context = { serverId: server.definition.id };
			const menu = this.menuService.getMenuActions(SessionsMcpServerItemMenuId, this.contextKeyService, { arg: context, shouldForwardArgs: true });
			const { secondary } = getContextMenuActions(menu, 'inline');

			if (secondary.length > 0) {
				this.contextMenuService.showContextMenu({
					getAnchor: () => e.anchor,
					getActions: () => secondary,
					getActionsContext: () => context,
					onHide: () => {
						this.serverStateContextKey.reset();
						this.serverEnabledContextKey.reset();
					},
				});
			}
			return;
		}

		// Tool item: simple menu (no actions yet, but keep extensible).
		const context = { serverId: e.element.server.definition.id, toolId: e.element.tool.id };
		const menu = this.menuService.getMenuActions(SessionsMcpToolItemMenuId, this.contextKeyService, { arg: context, shouldForwardArgs: true });
		const { secondary } = getContextMenuActions(menu, 'inline');
		if (secondary.length > 0) {
			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => secondary,
				getActionsContext: () => context,
			});
		}
	}

	public async toggleServerEnabled(serverId: string): Promise<void> {
		const server = this.mcpService.servers.get().find(s => s.definition.id === serverId);
		if (!server) {
			return;
		}
		const enabled = isContributionEnabled(server.enablement.get());
		this.mcpService.enablementModel.setEnabled(
			serverId,
			enabled ? ContributionEnablementState.DisabledWorkspace : ContributionEnablementState.EnabledWorkspace,
		);
	}
}

//#endregion

//#region Helpers

function connectionStateToClass(state: McpConnectionState.Kind): string {
	switch (state) {
		case McpConnectionState.Kind.Running: return 'running';
		case McpConnectionState.Kind.Starting: return 'starting';
		case McpConnectionState.Kind.Error: return 'error';
		case McpConnectionState.Kind.Stopped:
		default: return 'stopped';
	}
}

function stateLabel(state: McpConnectionState.Kind, enabled: boolean): string {
	if (!enabled) {
		return localize('mcpStateDisabled', "Disabled");
	}
	switch (state) {
		case McpConnectionState.Kind.Running: return localize('mcpStateRunning', "Running");
		case McpConnectionState.Kind.Starting: return localize('mcpStateStarting', "Starting");
		case McpConnectionState.Kind.Error: return localize('mcpStateError', "Error");
		case McpConnectionState.Kind.Stopped:
		default: return localize('mcpStateStopped', "Stopped");
	}
}

//#endregion
