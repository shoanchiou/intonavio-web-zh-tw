export interface PitchFrame {
  t: number;
  hz: number | null;
  confidence: number;
}
export interface PracticeResult {
  date: string;
  score: number;
  difficulty: string;
  samples: number;
  isLoop: boolean;
}
export interface Song {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  original?: Blob;
  videoId?: string;
  artist?: string;
  vocals?: Blob;
  instrumental?: Blob;
  reference?: PitchFrame[];
  history: PracticeResult[];
}
export type Track = "original" | "vocals" | "instrumental";
export type Difficulty = "beginner" | "intermediate" | "advanced";
export interface Detection {
  hz: number | null;
  confidence: number;
  rms: number;
  time?: number;
  error?: string;
}
