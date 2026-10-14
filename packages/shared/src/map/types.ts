export type TaskType = 'mimeograph' | 'cipher' | 'funds' | 'flag' | 'telegraph';

export interface Vec {
  x: number;
  y: number;
}

export interface MapData {
  width: number;
  height: number;
  /** height strings; '#' = wall, '.' = floor */
  tiles: string[];
  zones: { id: string; name: string; rect: { x: number; y: number; w: number; h: number } }[];
  /** 10 spawn points in 서점 뒷방 */
  spawns: Vec[];
  bell: Vec;
  /** in 전신국 */
  breaker: Vec;
  taskSpots: { id: string; type: TaskType; pos: Vec }[];
  passages: { id: string; name: string; tiles: Vec[] }[];
}
