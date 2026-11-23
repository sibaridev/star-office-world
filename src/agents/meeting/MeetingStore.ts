/**
 * Star Office World — Meeting Store
 * Persists meeting sessions, transcripts, and minutes to disk.
 */

import fs from "node:fs";
import path from "node:path";
import type { OfficeMeeting } from "./types.js";

export class MeetingStore {
  private dir: string;
  private cache = new Map<string, OfficeMeeting>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "meetings");
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {}
    this.loadAll();
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private loadAll(): void {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.dir, file), "utf-8");
          const meeting = JSON.parse(raw) as OfficeMeeting;
          if (meeting && meeting.id) {
            this.cache.set(meeting.id, meeting);
          }
        } catch {}
      }
    } catch {}
  }

  public saveMeeting(meeting: OfficeMeeting): void {
    this.cache.set(meeting.id, meeting);
    try {
      fs.writeFileSync(
        this.filePath(meeting.id),
        JSON.stringify(meeting, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.warn(`[meeting-store] Failed to save meeting ${meeting.id}:`, err);
    }
  }

  public getMeeting(id: string): OfficeMeeting | null {
    return this.cache.get(id) || null;
  }

  public listMeetings(): OfficeMeeting[] {
    return Array.from(this.cache.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  public getActiveMeeting(): OfficeMeeting | null {
    for (const meeting of this.cache.values()) {
      if (meeting.status === "IN_PROGRESS" || meeting.status === "CONCLUDING") {
        return meeting;
      }
    }
    return null;
  }
}
