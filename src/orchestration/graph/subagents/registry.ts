import { ALCHEMIST_SUBAGENT_CONFIG } from "./alchemist.js";
import { ARCHITECT_SUBAGENT_CONFIG } from "./architect.js";
import { ARCHIVIST_SUBAGENT_CONFIG } from "./archivist.js";
import { INQUISITOR_SUBAGENT_CONFIG } from "./inquisitor.js";
import { MECHANIC_SUBAGENT_CONFIG } from "./mechanic.js";
import { SCOUT_SUBAGENT_CONFIG } from "./scout.js";
import { SCRIBE_SUBAGENT_CONFIG } from "./scribe.js";
import type { GuildSubagentRole, SubagentConfig } from "./types.js";
import { VIBE_CURATOR_SUBAGENT_CONFIG } from "./vibe_curator.js";
import { WARDEN_SUBAGENT_CONFIG } from "./warden.js";

export const ORC_GUILD_SUBAGENT_REGISTRY: Readonly<Record<GuildSubagentRole, SubagentConfig>> = {
	architect: ARCHITECT_SUBAGENT_CONFIG,
	scout: SCOUT_SUBAGENT_CONFIG,
	mechanic: MECHANIC_SUBAGENT_CONFIG,
	inquisitor: INQUISITOR_SUBAGENT_CONFIG,
	warden: WARDEN_SUBAGENT_CONFIG,
	alchemist: ALCHEMIST_SUBAGENT_CONFIG,
	scribe: SCRIBE_SUBAGENT_CONFIG,
	archivist: ARCHIVIST_SUBAGENT_CONFIG,
	vibe_curator: VIBE_CURATOR_SUBAGENT_CONFIG,
};

export const ORC_GUILD_SUBAGENT_REGISTRY_ENTRIES: ReadonlyArray<SubagentConfig> = Object.freeze(
	Object.values(ORC_GUILD_SUBAGENT_REGISTRY),
);
