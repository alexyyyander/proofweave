-- Static bearer tokens were a closed-alpha experiment. Revoke them before the
-- remote OAuth MCP gateway becomes the only participant-facing connection.
UPDATE `mcp_access_tokens`
SET `revoked_at` = CURRENT_TIMESTAMP
WHERE `revoked_at` IS NULL;
