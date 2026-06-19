export interface Attachment {
  id: number;
  task_id: number;
  file_name: string;
  file_type: string;
  file_data: string;
  created_at: string;
}

export interface ForgejoLink {
  id: number;
  task_id: number;
  type: 'repo' | 'issue' | 'pr' | 'commit';
  title: string;
  url: string;
  repo_name: string;
  item_id: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  estimate: string | null;
  color: string;
  status: string;
  dependencies: number[];
  notes: string | null;
  attachments: Attachment[];
  group_id: number | null;
  position: number;
  forgejo_links?: ForgejoLink[];
}

export interface TaskGroup {
  id: number;
  name: string;
  color: string;
  collapsed: number;
  position: number;
}