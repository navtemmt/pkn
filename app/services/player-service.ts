import { DBService} from './db-service.ts';
import { emptyOrSingleRow } from '../helpers/db-query-helper.ts'

export class PlayerService {
    private db_service: DBService;
    
    constructor(db_service: DBService) {
        this.db_service = db_service;
    }

    async get(player_name: string): Promise<any> {
        const rows = await this.db_service.query(
            `SELECT *
             FROM PlayerStats
             WHERE name = ?`,
             [player_name]
        );
        return emptyOrSingleRow(rows);
    }

    // New method: Get formatted stats for ChatGPT prompts
    async getStatsForPrompt(player_name: string): Promise<string> {
        const stats = await this.get(player_name);
        if (!stats) return "Unknown player";

        const vpip = stats.total_hands > 0 ? (stats.vpip_hands / stats.total_hands * 100).toFixed(1) : "N/A";
        const pfr = stats.total_hands > 0 ? (stats.pfr_hands / stats.total_hands * 100).toFixed(1) : "N/A";
        
        return `${player_name}: ${stats.total_hands}h, ${vpip}% VPIP, ${pfr}% PFR`;
    }

    // New method: Get all active players' stats for current table
    async getTableStatsForPrompt(player_names: string[]): Promise<string> {
        const statsPromises = player_names.map(name => this.getStatsForPrompt(name));
        const stats = await Promise.all(statsPromises);
        return stats.join(" | ");
    }

    async create(player_stats_JSON: any): Promise<void> {
        await this.db_service.query(
            `INSERT OR REPLACE INTO PlayerStats
             (name, total_hands, walks, vpip_hands, pfr_hands, last_seen)
             VALUES
             (?, ?, ?, ?, ?, datetime('now'))`,
             [
                player_stats_JSON.name, 
                player_stats_JSON.total_hands, 
                player_stats_JSON.walks, 
                player_stats_JSON.vpip_hands,
                player_stats_JSON.pfr_hands
            ]
        );
    }
    
    async update(player_name: string, player_stats_JSON: any): Promise<void> {
        await this.db_service.query(
            `UPDATE PlayerStats
             SET 
                total_hands = ?,
                walks = ?,
                vpip_hands = ?,
                pfr_hands = ?,
                last_seen = datetime('now')
             WHERE name = ?`,
             [
                player_stats_JSON.total_hands, 
                player_stats_JSON.walks, 
                player_stats_JSON.vpip_hands,
                player_stats_JSON.pfr_hands,
                player_name
            ]
        );
    }

    // New method: Increment stats after each hand
    async updateHandStats(player_name: string, vpip: boolean, pfr: boolean, walked: boolean): Promise<void> {
        const existing = await this.get(player_name);
        
        if (existing) {
            await this.update(player_name, {
                total_hands: existing.total_hands + 1,
                walks: existing.walks + (walked ? 1 : 0),
                vpip_hands: existing.vpip_hands + (vpip ? 1 : 0),
                pfr_hands: existing.pfr_hands + (pfr ? 1 : 0)
            });
        } else {
            await this.create({
                name: player_name,
                total_hands: 1,
                walks: walked ? 1 : 0,
                vpip_hands: vpip ? 1 : 0,
                pfr_hands: pfr ? 1 : 0
            });
        }
    }
    
    async remove(player_name: string): Promise<void>{
        await this.db_service.query(
            `DELETE FROM PlayerStats
             WHERE name = ?`,
             [player_name]
        );
    }

    // New method: Get player type classification for ChatGPT
    async getPlayerType(player_name: string): Promise<string> {
        const stats = await this.get(player_name);
        if (!stats || stats.total_hands < 10) return "unknown";

        const vpip = (stats.vpip_hands / stats.total_hands) * 100;
        const pfr = (stats.pfr_hands / stats.total_hands) * 100;

        if (vpip >= 25 && pfr >= 20) return "LAG"; // Loose Aggressive
        if (vpip >= 25 && pfr < 20) return "LAP";  // Loose Passive
        if (vpip < 25 && pfr >= 15) return "TAG";  // Tight Aggressive
        return "TAP"; // Tight Passive
    }
}
