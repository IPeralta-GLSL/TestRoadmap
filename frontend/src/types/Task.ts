export interface Task {
  id: number;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  estimate: string | null;
}