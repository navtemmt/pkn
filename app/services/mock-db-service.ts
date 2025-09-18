export class MockDBService {
    private mockPlayers: Map<string, any> = new Map();

    async query(sql: string, params: any[]): Promise<any> {
        console.log(`Mock DB: ${sql}`, params);
        
        if (sql.toLowerCase().includes('select')) {
            const playerName = params[0];
            return this.mockPlayers.get(playerName) || null;
        }
        
        if (sql.toLowerCase().includes('insert') || sql.toLowerCase().includes('update')) {
            const [name, total_hands, walks, vpip_hands, pfr_hands] = params;
            this.mockPlayers.set(name, {
                name, total_hands, walks, vpip_hands, pfr_hands
            });
        }
        
        return { changes: 1 };
    }
}
