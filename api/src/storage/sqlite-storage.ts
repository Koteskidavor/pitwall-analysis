import { Storage } from '../storage';
import { sessionSchema, type Session } from '../../../shared/src/schemas';
import Database from 'better-sqlite3';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

export class SqliteStorage implements Storage {
  private db: Database.Database;
  private readonly rootPath: string;

  constructor(rootPath: string) {
    // Convert to absolute path relative to project root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Go up two levels from src/storage to project root: src/storage -> src -> api -> project root
    const projectRoot = join(__dirname, '..', '..', '..');
    const absoluteRootPath = join(projectRoot, rootPath);

    this.rootPath = absoluteRootPath;
    const dbPath = join(this.rootPath, 'sessions', '2023_2_Race', 'data.sqlite');
    console.log(`Opening database at: ${dbPath}`);
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`Project root: ${projectRoot}`);
    console.log(`Root path: ${this.rootPath}`);

    // Check if directory exists
    const sessionsDir = join(this.rootPath, 'sessions', '2023_2_Race');
    console.log(`Sessions directory exists: ${existsSync(sessionsDir)}`);
    console.log(`Database file exists: ${existsSync(dbPath)}`);

    // Open database in read-only mode
    this.db = new Database(dbPath, {
      readonly: true,
    });

    // Debug: List tables
    console.log('Listing tables:');
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(tables);

    // Debug: Check sessions table structure
    if (tables.some((t: any) => t.name === 'sessions')) {
      console.log('Sessions table structure:');
      const columns = this.db.prepare("PRAGMA table_info(sessions)").all();
      console.log(columns);

      // Debug: Count sessions
      const count = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
      console.log(`Session count: ${JSON.stringify(count)}`);
    }
  }

  async read(url: string): Promise<ArrayBuffer> {
    // For now, we'll implement this based on what we need for the API
    // This is a placeholder that will be enhanced as needed
    throw new Error('Method not implemented.');
  }

  async exists(url: string): Promise<boolean> {
    // Placeholder implementation
    throw new Error('Method not implemented.');
  }

  // Additional methods for session data
  async getSessions(): Promise<Session[]> {
    console.log('Fetching sessions...');
    try {
      const rows = this.db.prepare('SELECT * FROM sessions').all();
      console.log(`Query executed, found ${rows.length} rows`);
      if (rows.length > 0) {
        console.log('First row:', JSON.stringify(rows[0]));
      }
      const sessions = rows.map((row: any) => {
        try {
          return sessionSchema.parse(row);
        } catch (e) {
          console.error('Error parsing row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${sessions.length} sessions`);
      return sessions;
    } catch (error) {
      console.error('Error in getSessions:', error);
      throw error;
    }
  }

  async getSessionById(id: string): Promise<Session | null> {
    console.log(`Fetching session with ID: ${id}`);
    try {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      console.log(`Query for ID ${id} returned:`, row);
      if (!row) {
        console.log(`No session found with ID: ${id}`);
        return null;
      }
      const session = sessionSchema.parse(row);
      console.log(`Successfully parsed session:`, session);
      return session;
    } catch (error) {
      console.error(`Error in getSessionById for ID ${id}:`, error);
      throw error;
    }
  }
}
