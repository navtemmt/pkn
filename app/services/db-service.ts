import { Database, open } from 'sqlite'
import sqlite3 from 'sqlite3';

// app/services/db-service.ts

export class DBService {
    private mockData: Map<string, any> = new Map();

    constructor() {
        console.log("✅ Using Mock Database Service. No real database will be used.");
    }

    /**
     * A mock query method that simulates database interaction.
     * It returns empty arrays for SELECT queries and does nothing for others.
     */
    async query(sql: string, params: any[]): Promise<any[]> {
        console.log(`[Mock DB] Executing: ${sql.substring(0, 50)}...`, params);

        // For any SELECT query, return an empty array to prevent downstream errors
        if (sql.trim().toLowerCase().startsWith('select')) {
            return [];
        }

        // For INSERT, UPDATE, DELETE, simulate a successful operation
        return [];
    }
}

// Export a single instance of the service
const db_service = new DBService();
export default db_service;
