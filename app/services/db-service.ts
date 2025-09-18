import { Database, open } from 'sqlite'
import sqlite3 from 'sqlite3';

export class DBService {
    private mockData: Map<string, any> = new Map();

    async query(sql: string, params: any[]): Promise<any> {
        console.log('Mock Database Query:', sql, params);
        return []; // Return empty results for now
    }
}
    

    async query(sql: string, params: Array<any>): Promise<Array<string>> {
        var rows : string[] = [];
        await this.db.each(sql, params, (err: any, row: string) => {
            if (err) {
                throw new Error(err.message);
            }
            rows.push(row);
        });
        return rows;
    }
}

const db_service = new DBService("./app/pokernow-gpt.db");

export default db_service;
