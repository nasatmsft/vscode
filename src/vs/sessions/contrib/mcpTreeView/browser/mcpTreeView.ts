/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';

/**
 * View container id for the MCP servers view in the Agents Window auxiliary bar.
 */
export const SESSIONS_MCP_CONTAINER_ID = 'workbench.sessions.auxiliaryBar.mcpContainer';

/**
 * View id for the MCP servers tree view.
 */
export const SESSIONS_MCP_VIEW_ID = 'sessions.mcpServersView';

/**
 * Category used for MCP tree view commands.
 */
export const SESSIONS_MCP_CATEGORY = localize2('sessionsMcp', "MCP Servers");

/**
 * Menu id for MCP server grouping choices.
 */
export const SessionsMcpGroupByMenuId = new MenuId('sessions.mcpServers.groupBy');

/**
 * Context menu id for the MCP servers tree itself.
 */
export const SessionsMcpTreeContextMenuId = new MenuId('sessions.mcpServers.treeContext');

/**
 * Context menu id for individual MCP server tree items.
 */
export const SessionsMcpServerItemMenuId = new MenuId('sessions.mcpServers.serverItem');

/**
 * Context menu id for individual MCP tool tree items.
 */
export const SessionsMcpToolItemMenuId = new MenuId('sessions.mcpServers.toolItem');
