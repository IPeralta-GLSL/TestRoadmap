export interface Task {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  estimate: string | null;
  color: string;
  status: string;
  dependencies: number[];
}