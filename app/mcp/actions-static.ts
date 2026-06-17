import { DEFAULT_MCP_CONFIG, McpConfigData, ServerConfig } from "./types";

export function getClientsStatus() {
  return {};
}

export function getClientTools(_clientId: string) {
  return null;
}

export function getAvailableClientsCount() {
  return 0;
}

export function getAllTools() {
  return [];
}

export function initializeMcpSystem() {
  return DEFAULT_MCP_CONFIG;
}

export function addMcpServer(_clientId: string, _config: ServerConfig) {
  return DEFAULT_MCP_CONFIG;
}

export function pauseMcpServer(_clientId: string) {
  return DEFAULT_MCP_CONFIG;
}

export function resumeMcpServer(_clientId: string) {
  return undefined;
}

export function removeMcpServer(_clientId: string) {
  return DEFAULT_MCP_CONFIG;
}

export function restartAllClients() {
  return DEFAULT_MCP_CONFIG;
}

export function executeMcpAction() {
  throw new Error("MCP is disabled in mobile static builds.");
}

export function getMcpConfigFromFile(): McpConfigData {
  return DEFAULT_MCP_CONFIG;
}

export function isMcpEnabled() {
  return false;
}
