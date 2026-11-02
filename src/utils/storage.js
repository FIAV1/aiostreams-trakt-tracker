import { writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sync as glob } from 'glob';
import { format } from 'date-fns';
import { z } from 'zod';

export class FileStorage {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  async initialize(): Promise<void> {
    await this.ensureDirectoryExists();
  }

  private async ensureDirectoryExists(): Promise<void> {
    await writeFile(`${this.storagePath}/.gitkeep`, '');
  }

  async readFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async writeFile<T>(filePath: string, data: T): Promise<void> {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async getAllFiles(extension: string = '.json'): Promise<string[]> {
    return glob(`${this.storagePath}/**/*${extension}`, {
      cwd: this.storagePath,
      recursive: true,
    });
  }

  async backup(storageId: string, data: any, timestamp: string): Promise<void> {
    const backupPath = `${this.storagePath}/${storageId}-${timestamp}.backup.json`;
    await writeFile(backupPath, data);
  }

  async cleanup(maxBackups: number): Promise<void> {
    const backups = await this.getAllFiles('.backup.json');
    backups.sort((a, b) => {
      const dateA = a.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.backup/);
      const dateB = b.match(/-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.backup/);
      return dateB![1].localeCompare(dateA![1]);
    });

    const toDelete = backups.slice(maxBackups);
    for (const backup of toDelete) {
      await Bun.delete(backup);
    }
  }
}
