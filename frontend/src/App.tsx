import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { TbX, TbFileText, TbPalette, TbLink, TbTrash, TbArrowBackUp, TbArrowForwardUp, TbPhoto, TbPaperclip, TbDownload, TbChevronDown, TbChevronRight, TbFolder, TbSun, TbMoon, TbAlertTriangle, TbSettings } from 'react-icons/tb';
import { Task, Attachment, TaskGroup } from './types/Task';
import Viewer3D from './components/Viewer3D';
import { addDays, format, parseISO, differenceInDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

const API_URL = '/api';
const DAY_WIDTH_MIN = 30;
const DAY_WIDTH_DEFAULT = 60;
const ROW_HEIGHT = 48;
const DAY_WIDTH_MAX = 120;

const PRESET_COLORS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0',
  '#00bcd4', '#ff5722', '#607d8b', '#8bc34a', '#3f51b5',
];

const STATUS_OPTIONS = ['pendiente', 'en progreso', 'completada', 'cancelada'];

function getDayIndex(dateStr: string, viewStart: Date): number {
  const d = parseISO(dateStr);
  return differenceInDays(d, viewStart);
}

function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.max(0, Math.floor(r * factor));
  const dg = Math.max(0, Math.floor(g * factor));
  const db = Math.max(0, Math.floor(b * factor));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getDependencyErrorMessage(task: Task, allTasks: Task[]): string | null {
  if (!task.dependencies || task.dependencies.length === 0) return null;
  for (const depId of task.dependencies) {
    const depTask = allTasks.find(t => t.id === depId);
    if (!depTask) continue;
    const taskStart = parseISO(task.start_date);
    const depEnd = parseISO(depTask.end_date);
    if (differenceInDays(taskStart, depEnd) < 0) {
      return `Inicia antes de finalizar "${depTask.name}"`;
    }
  }
  return null;
}

interface DragState {
  taskId: number;
  type: 'move' | 'resize-left' | 'resize-right';
  startX: number;
  origStart: string;
  origEnd: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  taskId: number;
}

interface DetailModalState {
  taskId: number;
}

const MAX_HISTORY = 50;

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [viewStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  });
  const [dayWidth, setDayWidth] = useState(DAY_WIDTH_DEFAULT);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const dragDeltaRef = useRef(0);
  const [dragDelta, setDragDelta] = useState(0);
  const tasksRef = useRef<Task[]>([]);
  const dayWidthRef = useRef(DAY_WIDTH_DEFAULT);
  const linkModeRef = useRef<{ fromTaskId: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const calendarContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [linkMode, setLinkMode] = useState<{ fromTaskId: number } | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; time: number; button: number } | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const addDropdownRef = useRef<HTMLDivElement>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupId: number } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupColorPickerFor, setGroupColorPickerFor] = useState<number | null>(null);
  const groupContextMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('roadmapper-sidebar-width') || '192');
  });
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('roadmapper-theme') as 'light' | 'dark') || 'light';
  });
  const [hoveredTask, setHoveredTask] = useState<number | null>(null);
  const [sidebarDragTaskId, setSidebarDragTaskId] = useState<number | null>(null);
  const [sidebarDragOverGroupId, setSidebarDragOverGroupId] = useState<number | null | 'ungrouped'>('ungrouped');

  const [history, setHistory] = useState<Task[][]>([[]]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const isUndoRedoRef = useRef(false);

  const numDays = 60;

  const isDark = theme === 'dark';

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('roadmapper-theme', next);
  };

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { dayWidthRef.current = dayWidth; }, [dayWidth]);
  useEffect(() => { linkModeRef.current = linkMode; }, [linkMode]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tasks`);
      const data: Task[] = await res.json();
      setTasks(data);
      if (!isUndoRedoRef.current) {
        setHistory(prev => {
          const newHist = [...prev.slice(0, historyIdx + 1), data];
          if (newHist.length > MAX_HISTORY) newHist.shift();
          return newHist;
        });
        setHistoryIdx(prev => Math.min(prev + 1, MAX_HISTORY - 1));
      }
      isUndoRedoRef.current = false;
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  }, [historyIdx]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/groups`);
      const data: TaskGroup[] = await res.json();
      setGroups(data);
    } catch (err) {
      console.error('Error fetching groups:', err);
    }
  }, []);

  const moveTask = async (taskId: number, newGroupId: number | null, position: number) => {
    try {
      await fetch(`${API_URL}/tasks/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, group_id: newGroupId, position }),
      });
      await fetchTasks();
    } catch (err) {
      console.error('Error moving task:', err);
    }
  };

  const handleSidebarDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData('text/plain', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
    setSidebarDragTaskId(taskId);
  };

  const handleSidebarDragEnd = () => {
    setSidebarDragTaskId(null);
    setSidebarDragOverGroupId('ungrouped');
  };

  const handleGroupDrop = (e: React.DragEvent, groupId: number | null) => {
    e.preventDefault();
    const taskId = parseInt(e.dataTransfer.getData('text/plain'));
    if (!taskId) return;
    const existingInTarget = tasks.filter(t => t.group_id === groupId && t.id !== taskId);
    const maxPos = existingInTarget.reduce((max, t) => Math.max(max, t.position ?? 0), -1);
    moveTask(taskId, groupId, maxPos + 1);
    setSidebarDragTaskId(null);
    setSidebarDragOverGroupId('ungrouped');
  };

  const handleGroupDragOver = (e: React.DragEvent, groupId: number | null | 'ungrouped') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setSidebarDragOverGroupId(groupId);
  };

  useEffect(() => {
    fetchTasks();
    fetchGroups();
  }, []);

  useEffect(() => {
    const socket: Socket = io(window.location.origin, {
      path: '/socket.io',
    });

    socket.on('connect', () => { });

    socket.on('task-created', (task: Task) => {
      setTasks((prev) => {
        if (prev.find(t => t.id === task.id)) return prev;
        return [...prev, task];
      });
    });

    socket.on('task-updated', (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    });

    socket.on('task-deleted', (taskId: number) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    });

    socket.on('group-created', (group: TaskGroup) => {
      setGroups((prev) => {
        if (prev.find(g => g.id === group.id)) return prev;
        return [...prev, group];
      });
    });

    socket.on('group-updated', (group: TaskGroup) => {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? group : g)));
    });

    socket.on('group-deleted', (groupId: number) => {
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
    });

    socket.on('project-imported', () => {
      fetchTasks();
      fetchGroups();
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setColorPickerFor(null);
      }
      if (groupContextMenu && groupContextMenuRef.current && !groupContextMenuRef.current.contains(e.target as Node)) {
        setGroupContextMenu(null);
        setGroupColorPickerFor(null);
      }
      if (showAddDropdown && addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
        setShowAddDropdown(false);
      }
      if (showProjectDropdown && projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu, groupContextMenu, showAddDropdown, showProjectDropdown]);

  const addTask = async (groupId?: number | null) => {
    const today = new Date();
    const end = addDays(today, 7);
    try {
      await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nueva tarea',
          start_date: format(today, 'yyyy-MM-dd'),
          end_date: format(end, 'yyyy-MM-dd'),
          estimate: '',
          color: '#4caf50',
          status: 'pendiente',
          notes: '',
          group_id: groupId || null,
        }),
      });
      await fetchTasks();
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  const addGroup = async () => {
    try {
      await fetch(`${API_URL}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nuevo grupo', color: '#607d8b' }),
      });
      await fetchGroups();
    } catch (err) {
      console.error('Error creating group:', err);
    }
  };

  const deleteGroup = async (id: number) => {
    try {
      await fetch(`${API_URL}/groups/${id}`, { method: 'DELETE' });
      await fetchGroups();
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting group:', err);
    }
  };

  const updateGroup = async (id: number, updates: Partial<TaskGroup>) => {
    try {
      const group = groups.find(g => g.id === id);
      if (!group) return;
      await fetch(`${API_URL}/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...group, ...updates }),
      });
      await fetchGroups();
    } catch (err) {
      console.error('Error updating group:', err);
    }
  };

  const toggleGroupCollapse = async (id: number) => {
    const group = groups.find(g => g.id === id);
    if (!group) return;
    await updateGroup(id, { collapsed: group.collapsed ? 0 : 1 });
  };

  const handleExportProject = async () => {
    try {
      const res = await fetch(`${API_URL}/project/export`);
      if (!res.ok) throw new Error('Error exporting project');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `proyecto-roadmap-${format(new Date(), 'yyyy-MM-dd-HH-mm')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Error al exportar el proyecto');
    }
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string);
        const res = await fetch(`${API_URL}/project/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Error importing project');
        await fetchTasks();
        await fetchGroups();
        alert('Proyecto importado con éxito');
      } catch (err) {
        console.error(err);
        alert('Archivo de proyecto inválido o error al importar');
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handleClearProject = async () => {
    if (!confirm('¿Estás seguro de que deseas limpiar todo el proyecto? Se borrarán todas las tareas, grupos y archivos adjuntos.')) return;
    try {
      const res = await fetch(`${API_URL}/project/clear`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Error resetting project');
      await fetchTasks();
      await fetchGroups();
      alert('Proyecto limpiado con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al limpiar el proyecto');
    }
  };

  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(120, Math.min(450, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
      localStorage.setItem('roadmapper-sidebar-width', String(newWidth));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const deleteTask = async (id: number) => {
    try {
      await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  const updateTask = async (id: number, updates: Partial<Task>) => {
    try {
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const body = { ...task, ...updates };
      await fetch(`${API_URL}/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await fetchTasks();
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  const addDependency = async (taskId: number, dependsOnId: number) => {
    try {
      await fetch(`${API_URL}/tasks/${taskId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depends_on_id: dependsOnId }),
      });
      await fetchTasks();
    } catch (err) {
      console.error('Error adding dependency:', err);
    }
  };

  const handleUndo = async () => {
    if (historyIdx <= 0) return;
    const prevIdx = historyIdx - 1;
    const prevTasks = history[prevIdx];
    if (!prevTasks) return;
    isUndoRedoRef.current = true;
    setHistoryIdx(prevIdx);
    setTasks(prevTasks);
    try {
      for (const task of tasks) {
        const existsInPrev = prevTasks.find(t => t.id === task.id);
        if (!existsInPrev) {
          await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
        }
      }
      for (const pt of prevTasks) {
        const currentTask = tasks.find(t => t.id === pt.id);
        if (!currentTask) {
          await fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pt),
          });
        } else if (
          currentTask.name !== pt.name ||
          currentTask.start_date !== pt.start_date ||
          currentTask.end_date !== pt.end_date ||
          currentTask.color !== pt.color ||
          currentTask.status !== pt.status ||
          currentTask.estimate !== pt.estimate
        ) {
          await fetch(`${API_URL}/tasks/${pt.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pt),
          });
        }
      }
      await fetchTasks();
    } catch (err) {
      console.error('Error during undo:', err);
    }
  };

  const handleRedo = async () => {
    if (historyIdx >= history.length - 1) return;
    const nextIdx = historyIdx + 1;
    const nextTasks = history[nextIdx];
    if (!nextTasks) return;
    isUndoRedoRef.current = true;
    setHistoryIdx(nextIdx);
    setTasks(nextTasks);
    try {
      for (const task of tasks) {
        const existsInNext = nextTasks.find(t => t.id === task.id);
        if (!existsInNext) {
          await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
        }
      }
      for (const nt of nextTasks) {
        const currentTask = tasks.find(t => t.id === nt.id);
        if (!currentTask) {
          await fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nt),
          });
        } else if (
          currentTask.name !== nt.name ||
          currentTask.start_date !== nt.start_date ||
          currentTask.end_date !== nt.end_date ||
          currentTask.color !== nt.color ||
          currentTask.status !== nt.status ||
          currentTask.estimate !== nt.estimate
        ) {
          await fetch(`${API_URL}/tasks/${nt.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nt),
          });
        }
      }
      await fetchTasks();
    } catch (err) {
      console.error('Error during redo:', err);
    }
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    const el = calendarContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isInCalendar = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (isInCalendar) {
      e.preventDefault();
      setDayWidth(prev => {
        const delta = e.deltaY > 0 ? -3 : 3;
        return Math.min(DAY_WIDTH_MAX, Math.max(DAY_WIDTH_MIN, prev + delta));
      });
    }
  }, []);

  useEffect(() => {
    const el = calendarContainerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseDown = (
    e: React.MouseEvent,
    taskId: number,
    type: 'move' | 'resize-left' | 'resize-right',
    origStart: string,
    origEnd: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now(), button: e.button };
    setDragging({ taskId, type, startX: e.clientX, origStart, origEnd });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragging.startX;
      dragDeltaRef.current = delta;
      setDragDelta(delta);
    };

    const handleMouseUp = () => {
      const currentDelta = dragDeltaRef.current;
      const currentDayWidth = dayWidthRef.current;
      const currentTasks = tasksRef.current;
      const currentLinkMode = linkModeRef.current;

      if (dragStartRef.current) {
        const elapsed = Date.now() - dragStartRef.current.time;
        const button = dragStartRef.current.button;
        dragStartRef.current = null;

        if (elapsed < 200 && Math.abs(currentDelta) < 3 && button === 0) {
          if (currentLinkMode) {
            if (currentLinkMode.fromTaskId !== dragging.taskId) {
              addDependency(dragging.taskId, currentLinkMode.fromTaskId);
            }
            setLinkMode(null);
          } else {
            setDetailModal({ taskId: dragging.taskId });
          }
        }
      }

      const daysDelta = Math.round(currentDelta / currentDayWidth);
      if (daysDelta !== 0) {
        const task = currentTasks.find((t) => t.id === dragging.taskId);
        if (task) {
          let newStart = dragging.origStart;
          let newEnd = dragging.origEnd;

          if (dragging.type === 'move') {
            newStart = format(addDays(parseISO(dragging.origStart), daysDelta), 'yyyy-MM-dd');
            newEnd = format(addDays(parseISO(dragging.origEnd), daysDelta), 'yyyy-MM-dd');
          } else if (dragging.type === 'resize-left') {
            newStart = format(addDays(parseISO(dragging.origStart), daysDelta), 'yyyy-MM-dd');
          } else if (dragging.type === 'resize-right') {
            newEnd = format(addDays(parseISO(dragging.origEnd), daysDelta), 'yyyy-MM-dd');
          }

          updateTask(task.id, { start_date: newStart, end_date: newEnd });
        }
      }
      dragDeltaRef.current = 0;
      setDragging(null);
      setDragDelta(0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging]);

  const handleContextMenu = (e: React.MouseEvent, taskId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
    setColorPickerFor(null);
  };

  const calendarDays: Date[] = [];
  for (let i = 0; i < numDays; i++) {
    calendarDays.push(addDays(viewStart, i));
  }

  const weeks: { weekStart: Date; days: Date[] }[] = [];
  let currentWeek: Date[] = [];
  let currentWeekStart = startOfWeek(calendarDays[0], { weekStartsOn: 1 });
  calendarDays.forEach((day) => {
    const ws = startOfWeek(day, { weekStartsOn: 1 });
    if (!isSameDay(ws, currentWeekStart)) {
      if (currentWeek.length > 0) {
        weeks.push({ weekStart: currentWeekStart, days: currentWeek });
      }
      currentWeek = [day];
      currentWeekStart = ws;
    } else {
      currentWeek.push(day);
    }
  });
  if (currentWeek.length > 0) {
    weeks.push({ weekStart: currentWeekStart, days: currentWeek });
  }

  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const getDependencyErrorMessageForTask = (task: Task): string | null => {
    return getDependencyErrorMessage(task, tasks);
  };

  const hasInvalidDependencies = (task: Task): boolean => {
    return getDependencyErrorMessageForTask(task) !== null;
  };

  const GROUP_HEADER_HEIGHT = ROW_HEIGHT;

  interface SidebarRow {
    type: 'group-header' | 'ungrouped-header' | 'task';
    groupId?: number | null;
    groupColor?: string;
    task?: Task;
  }

  const sidebarRows: SidebarRow[] = [];
  for (const group of groups) {
    const groupTasks = tasks.filter(t => t.group_id === group.id);
    sidebarRows.push({ type: 'group-header', groupId: group.id, groupColor: group.color });
    if (!group.collapsed) {
      groupTasks.forEach(task => sidebarRows.push({ type: 'task', task, groupId: group.id, groupColor: group.color }));
    }
  }
  sidebarRows.push({ type: 'ungrouped-header', groupId: null });
  const ungroupedTasks = tasks.filter(t => !t.group_id);
  ungroupedTasks.forEach(task => sidebarRows.push({ type: 'task', task }));

  const getTaskRects = () => {
    return tasks.map((task) => {
      const startIdx = getDayIndex(task.start_date, viewStart);
      const endIdx = getDayIndex(task.end_date, viewStart);
      const duration = endIdx - startIdx;
      let left = startIdx * dayWidth;
      let width = Math.max(duration * dayWidth, dayWidth);

      let currentLeft = left;
      let currentWidth = width;
      let currentStartDate = task.start_date;
      if (dragging && dragging.taskId === task.id) {
        const daysDelta = Math.round(dragDelta / dayWidth);
        if (dragging.type === 'move') {
          currentLeft = left + daysDelta * dayWidth;
          currentStartDate = format(addDays(parseISO(dragging.origStart), daysDelta), 'yyyy-MM-dd');
        } else if (dragging.type === 'resize-left') {
          currentLeft = left + daysDelta * dayWidth;
          currentStartDate = format(addDays(parseISO(dragging.origStart), daysDelta), 'yyyy-MM-dd');
          currentWidth = width - daysDelta * dayWidth;
        } else if (dragging.type === 'resize-right') {
          currentWidth = width + daysDelta * dayWidth;
        }
      }

      const isInvalid = hasInvalidDependencies({
        ...task,
        start_date: dragging && dragging.taskId === task.id ? currentStartDate : task.start_date,
      });

      return { task, left: currentLeft, width: currentWidth, isInvalid };
    });
  };

  const getTaskY = (taskId: number): number => {
    let y = 0;
    for (const row of sidebarRows) {
      if (row.type === 'task' && row.task?.id === taskId) return y;
      y += row.type === 'task' ? ROW_HEIGHT : GROUP_HEADER_HEIGHT;
    }
    return 0;
  };

  const totalRowsHeight = sidebarRows.reduce((t, r) => t + (r.type === 'task' ? ROW_HEIGHT : GROUP_HEADER_HEIGHT), 0);

  const getTaskGroupRect = (task: Task): { left: number; width: number } | null => {
    for (const group of groups) {
      if (group.collapsed && task.group_id === group.id) {
        const sIdx = getDayIndex(task.start_date, viewStart);
        const eIdx = getDayIndex(task.end_date, viewStart);
        const dur = eIdx - sIdx;
        const ctLeft = sIdx * dayWidth;
        const ctWidth = Math.max(dur * dayWidth, dayWidth);
        return { left: ctLeft + 2, width: ctWidth - 4 };
      }
    }
    return null;
  };

  const renderArrows = () => {
    const rects = getTaskRects();
    const arrows: React.ReactNode[] = [];

    tasks.forEach(task => {
      if (!task.dependencies || task.dependencies.length === 0) return;
      const taskRect = rects.find(r => r.task.id === task.id);
      if (!taskRect) {
        const group = task.group_id ? groups.find(g => g.id === task.group_id) : null;
        if (!group || !group.collapsed) return;
        return;
      }
      const taskY = getTaskY(task.id);

      task.dependencies.forEach(depId => {
        let depRect = rects.find(r => r.task.id === depId);
        if (!depRect) {
          const depTask = tasks.find(t => t.id === depId);
          if (!depTask) return;
          const collapsedRect = getTaskGroupRect(depTask);
          if (collapsedRect) {
            const depY = getTaskY(depId);
            const fromX = collapsedRect.left + collapsedRect.width - 2;
            const fromY = depY + 8 + (ROW_HEIGHT - 16) / 2;
            const toX = taskRect.left + 2;
            const toY = taskY + 8 + (ROW_HEIGHT - 16) / 2;
            const midX = fromX + (toX - fromX) / 2;
            arrows.push(
              <path key={`arrow-${task.id}-${depId}`} d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`} stroke={darkenColor(task.color || '#4caf50', 0.6)} strokeWidth={2} fill="none" markerEnd={`url(#arrowhead-${task.id})`} />
            );
          }
          return;
        }
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask) return;
        const depY = getTaskY(depId);
        const fromX = depRect.left + depRect.width - 2;
        const fromY = depY + 8 + (ROW_HEIGHT - 16) / 2;
        const toX = taskRect.left + 2;
        const toY = taskY + 8 + (ROW_HEIGHT - 16) / 2;
        const midX = fromX + (toX - fromX) / 2;

        arrows.push(
          <path key={`arrow-${task.id}-${depId}`} d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`} stroke={darkenColor(task.color || '#4caf50', 0.6)} strokeWidth={2} fill="none" markerEnd={`url(#arrowhead-${task.id})`} />
        );
      });
    });

    if (arrows.length === 0) return null;
    return (
      <svg style={{ position: 'absolute', top: 0, left: sidebarWidth, width: numDays * dayWidth, height: totalRowsHeight, pointerEvents: 'none', zIndex: 5 }}>
        <defs>
          {tasks.filter(t => t.dependencies && t.dependencies.length > 0).map(task => (
            <marker key={`marker-${task.id}`} id={`arrowhead-${task.id}`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={darkenColor(task.color || '#4caf50', 0.6)} />
            </marker>
          ))}
        </defs>
        {arrows}
      </svg>
    );
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaTargetTaskId, setMediaTargetTaskId] = useState<number | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const uploadAttachment = (taskId: number, file: File) => {
    const fileKey = `${file.name}-${Date.now()}`;
    setUploadProgress(prev => ({ ...prev, [fileKey]: 0 }));

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setUploadProgress(prev => ({ ...prev, [fileKey]: pct }));
      }
    };
    reader.onload = async (ev) => {
      setUploadProgress(prev => ({ ...prev, [fileKey]: 90 }));
      const data = ev.target?.result as string;
      try {
        const res = await fetch(`${API_URL}/tasks/${taskId}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: file.name,
            file_type: file.type,
            file_data: data,
          }),
        });
        if (!res.ok) {
          throw new Error(`Upload failed: ${res.statusText || res.status}`);
        }
        const result = await res.json();
        if (result.task) {
          setTasks(prev => prev.map(t => t.id === taskId ? result.task : t));
        }
        setUploadProgress(prev => ({ ...prev, [fileKey]: 100 }));
        setTimeout(() => {
          setUploadProgress(prev => {
            const next = { ...prev };
            delete next[fileKey];
            return next;
          });
        }, 800);
      } catch (err) {
        console.error('Error uploading attachment:', err);
        alert(err instanceof Error ? err.message : 'Error uploading attachment');
        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[fileKey];
          return next;
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAttachFile = (taskId: number) => {
    setMediaTargetTaskId(taskId);
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const taskId = mediaTargetTaskId;
    if (!files || !taskId) return;
    for (let i = 0; i < files.length; i++) {
      uploadAttachment(taskId, files[i]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      const res = await fetch(`${API_URL}/attachments/${attachmentId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.task) {
        setTasks(prev => prev.map(t => t.id === result.task.id ? result.task : t));
      }
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting attachment:', err);
    }
  };

  const handleDropZone = (e: React.DragEvent<HTMLDivElement>, taskId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTaskId(null);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      uploadAttachment(taskId, files[i]);
    }
  };

  const handlePasteToAttachments = (e: React.ClipboardEvent<HTMLTextAreaElement>, taskId: number) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) uploadAttachment(taskId, file);
        break;
      }
    }
  };

  const getFileCategory = (mimeType: string, fileName?: string): 'image' | 'video' | 'audio' | '3d' | 'other' => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('model') || mimeType === 'application/octet-stream' || mimeType === 'application/gltf-binary' || mimeType === 'application/json') {
      if (fileName && (fileName.endsWith('.glb') || fileName.endsWith('.gltf'))) return '3d';
      if (mimeType.includes('model') || mimeType === 'application/gltf-binary') return '3d';
    }
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext && ['fbx', 'obj', 'stl', '3ds', 'dae', 'off', 'ply', 'wrl', '3mf'].includes(ext)) return '3d';
    }
    return 'other';
  };

  const tBg = isDark ? '#1a1a1a' : '#f5f5f5';
  const cardBg = isDark ? '#2a2a2a' : '#ffffff';
  const borderColor = isDark ? '#3a3a3a' : '#e0e0e0';
  const subtleBg = isDark ? '#222222' : '#fafafa';
  const textPrimary = isDark ? '#e0e0e0' : '#333333';
  const textSecondary = isDark ? '#888888' : '#666666';
  const textMuted = isDark ? '#666666' : '#999999';

  const sidebarDragHighlight = (groupId: number | null) =>
    sidebarDragOverGroupId === groupId && sidebarDragTaskId !== null;

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: tBg, color: textPrimary, transition: 'background-color 0.3s ease, color 0.3s ease' }}>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.glb,.gltf,.fbx,.obj,.stl,.3ds,.dae,.off,.ply,.wrl,.3mf"
        onChange={handleFileChange}
      />
      <input
        type="file"
        ref={projectFileInputRef}
        className="hidden"
        accept=".json"
        onChange={handleImportProject}
      />

      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor, backgroundColor: cardBg }}>
        <div className="flex items-center gap-2">
          <div ref={projectDropdownRef} className="relative">
            <button
              className="px-3 py-1 text-xs rounded hover:opacity-80 transition-colors flex items-center gap-1 font-medium"
              style={{ backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0', color: textPrimary }}
              onClick={() => setShowProjectDropdown(!showProjectDropdown)}
            >
              <TbFolder size={14} /> Proyecto ▾
            </button>
            {showProjectDropdown && (
              <div className="absolute left-0 top-full mt-1 z-50 border rounded shadow-lg" style={{ backgroundColor: cardBg, borderColor, minWidth: 170 }}>
                <button className="w-full px-3 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2 border-b" style={{ color: textPrimary, borderColor }} onClick={() => { setShowProjectDropdown(false); handleClearProject(); }}>
                  <TbFileText size={14} /> Nuevo proyecto
                </button>
                <button className="w-full px-3 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={() => { setShowProjectDropdown(false); projectFileInputRef.current?.click(); }}>
                  <TbFolder size={14} /> Importar proyecto
                </button>
                <button className="w-full px-3 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={() => { setShowProjectDropdown(false); handleExportProject(); }}>
                  <TbDownload size={14} /> Exportar proyecto
                </button>
              </div>
            )}
          </div>
          <div ref={addDropdownRef} className="relative">
            <button
              className="px-3 py-1 text-xs rounded hover:opacity-80 transition-colors flex items-center gap-1 font-medium"
              style={{ backgroundColor: '#4caf50', color: '#fff' }}
              onClick={() => setShowAddDropdown(!showAddDropdown)}
            >
              + Agregar
            </button>
            {showAddDropdown && (
              <div className="absolute left-0 top-full mt-1 z-50 border rounded shadow-lg" style={{ backgroundColor: cardBg, borderColor, minWidth: 160 }}>
                <button className="w-full px-3 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={(e) => { e.stopPropagation(); addTask(); setShowAddDropdown(false); }}>
                  <TbFileText size={14} /> Agregar tarea
                </button>
                <button className="w-full px-3 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={(e) => { e.stopPropagation(); addGroup(); setShowAddDropdown(false); }}>
                  <TbFolder size={14} /> Agregar grupo
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 mx-1" style={{ backgroundColor: borderColor }} />
          <button
            onClick={() => setDayWidth(Math.max(DAY_WIDTH_MIN, dayWidth - 15))}
            className="px-2 py-1 text-xs rounded hover:opacity-80 transition-colors"
            style={{ backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0', color: textPrimary }}
          >
            −
          </button>
          <span className="text-[10px] w-12 text-center" style={{ color: textMuted }}>{dayWidth}px</span>
          <button
            onClick={() => setDayWidth(Math.min(DAY_WIDTH_MAX, dayWidth + 15))}
            className="px-2 py-1 text-xs rounded hover:opacity-80 transition-colors"
            style={{ backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0', color: textPrimary }}
          >
            +
          </button>
          <div className="w-px h-4 mx-1" style={{ backgroundColor: borderColor }} />
          <button
            onClick={handleUndo}
            disabled={historyIdx <= 0}
            className={`px-2 py-1 text-xs rounded hover:opacity-80 transition-colors ${historyIdx <= 0 ? 'cursor-not-allowed opacity-40' : ''}`}
            style={{ backgroundColor: isDark ? '#2a2a2a' : '#e0e0e0', color: textPrimary }}
            title="Deshacer"
          >
            <TbArrowBackUp size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIdx >= history.length - 1}
            className={`px-2 py-1 text-xs rounded hover:opacity-80 transition-colors ${historyIdx >= history.length - 1 ? 'cursor-not-allowed opacity-40' : ''}`}
            style={{ backgroundColor: isDark ? '#2a2a2a' : '#e0e0e0', color: textPrimary }}
            title="Rehacer"
          >
            <TbArrowForwardUp size={14} />
          </button>
        </div>
        <h1 className="text-base font-semibold tracking-tight">Pipeline de Actividad Semanal</h1>
        <div className="flex items-center gap-2">
          {linkMode && (
            <span className="text-[10px] text-orange-600 bg-orange-100 px-2 py-1 rounded">
              Click en tarea destino
              <button onClick={() => setLinkMode(null)} className="ml-2 text-orange-800 font-bold">✕</button>
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="px-2 py-1 text-xs rounded hover:opacity-80 transition-colors"
            style={{ backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0', color: textPrimary }}
            title={isDark ? 'Tema claro' : 'Tema oscuro'}
          >
            {isDark ? <TbSun size={16} /> : <TbMoon size={16} />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
        >
          <div
            ref={calendarContainerRef}
            className="relative"
            style={{ minWidth: numDays * dayWidth }}
          >
            <div className="h-px" style={{ backgroundColor: borderColor }} />

            <div className="flex border-b sticky top-0 z-20" style={{ borderColor, backgroundColor: subtleBg, transition: 'background-color 0.3s ease, border-color 0.3s ease' }}>
              <div
                className="flex-shrink-0 border-r sticky left-0 relative"
                style={{ width: sidebarWidth, borderColor, backgroundColor: subtleBg, zIndex: 30 }}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 z-30 transition-colors"
                  onMouseDown={handleSidebarResizeStart}
                />
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex" style={{ width: week.days.length * dayWidth }}>
                  <div className="text-[10px] font-medium px-1 py-1" style={{ width: week.days.length * dayWidth, color: textMuted }}>
                    {format(week.weekStart, 'MMM yyyy', { locale: es })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex border-b sticky top-0 z-10" style={{ borderColor, backgroundColor: subtleBg, transition: 'background-color 0.3s ease, border-color 0.3s ease' }}>
              <div
                className="flex-shrink-0 border-r sticky left-0 relative"
                style={{ width: sidebarWidth, borderColor, backgroundColor: subtleBg, zIndex: 25 }}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 z-30 transition-colors"
                  onMouseDown={handleSidebarResizeStart}
                />
              </div>
              {calendarDays.map((day, i) => {
                const dayOfWeek = day.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                return (
                  <div
                    key={i}
                    className="text-center border-r"
                    style={{
                      width: dayWidth,
                      borderColor,
                      backgroundColor: isWeekend ? (isDark ? '#252525' : '#f0f0f0') : subtleBg,
                    }}
                  >
                    <div className="text-[10px]" style={{ color: textMuted }}>{dayNames[(dayOfWeek + 6) % 7]}</div>
                    <div className="h-px my-0.5" style={{ backgroundColor: borderColor }} />
                    <div className="text-[10px] font-medium">{format(day, 'd')}</div>
                  </div>
                );
              })}
            </div>

            <div className="relative">
              {sidebarRows.map((row) => {
                if (row.type === 'group-header') {
                  const group = groups.find(g => g.id === row.groupId);
                  if (!group) return null;
                  const collapsedGroupTasks = group.collapsed ? tasks.filter(t => t.group_id === group.id) : [];

                  return (
                    <div
                      key={`group-row-${group.id}`}
                      className="flex border-b"
                      style={{
                        height: GROUP_HEADER_HEIGHT,
                        borderBottom: `1px solid ${borderColor}`,
                        backgroundColor: sidebarDragHighlight(group.id) ? hexToRgba(group.color, 0.25) : subtleBg,
                      }}
                      onDragOver={(e) => handleGroupDragOver(e, group.id)}
                      onDrop={(e) => handleGroupDrop(e, group.id)}
                      onDragLeave={() => setSidebarDragOverGroupId('ungrouped')}
                    >
                      <div
                        className="flex-shrink-0 border-r flex items-center px-2 gap-1 sticky left-0 group"
                        style={{ width: sidebarWidth, borderColor, borderLeft: `3px solid ${group.color}`, backgroundColor: subtleBg, zIndex: 25 }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id });
                          setGroupColorPickerFor(null);
                        }}
                      >
                        <button onClick={() => toggleGroupCollapse(group.id)} style={{ color: textMuted }}>
                          {group.collapsed ? <TbChevronRight size={9} /> : <TbChevronDown size={9} />}
                        </button>
                        {editingGroupId === group.id ? (
                          <input
                            autoFocus
                            className="flex-1 text-[9px] font-semibold px-1 border rounded outline-none"
                            style={{ backgroundColor: cardBg, color: textPrimary, borderColor }}
                            defaultValue={group.name}
                            onBlur={(e) => {
                              updateGroup(group.id, { name: e.target.value });
                              setEditingGroupId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateGroup(group.id, { name: (e.target as HTMLInputElement).value });
                                setEditingGroupId(null);
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="flex-1 text-[9px] font-semibold truncate cursor-pointer hover:underline"
                            style={{ color: textPrimary }}
                            onDoubleClick={() => setEditingGroupId(group.id)}
                            title="Doble clic para editar nombre"
                          >
                            {group.name}
                          </span>
                        )}
                        {group.collapsed && <span className="text-[8px] mr-1" style={{ color: textMuted }}>{collapsedGroupTasks.length}</span>}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setGroupContextMenu({ x: rect.left, y: rect.bottom, groupId: group.id });
                            setGroupColorPickerFor(null);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-500 p-0.5"
                          title="Opciones de grupo"
                        >
                          <TbSettings size={11} />
                        </button>
                      </div>
                      <div className="flex-1 relative">
                        {group.collapsed && collapsedGroupTasks.map(ct => {
                          const sIdx = getDayIndex(ct.start_date, viewStart);
                          const eIdx = getDayIndex(ct.end_date, viewStart);
                          const dur = eIdx - sIdx;
                          const ctLeft = sIdx * dayWidth;
                          const ctWidth = Math.max(dur * dayWidth, dayWidth);
                          return (
                            <div
                              key={`collapsed-bar-${ct.id}`}
                              className="absolute rounded-[2px]"
                              style={{ left: ctLeft + 2, width: ctWidth - 4, top: GROUP_HEADER_HEIGHT - 12, height: 8, backgroundColor: ct.color || '#4caf50', opacity: 0.7 }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (row.type === 'ungrouped-header') {
                  return (
                    <div key="ungrouped" className="flex border-b" style={{ height: GROUP_HEADER_HEIGHT, borderBottom: `1px solid ${borderColor}` }}>
                      <div
                        className="flex-shrink-0 border-r flex items-center px-2 sticky left-0"
                        style={{ width: sidebarWidth, borderColor, backgroundColor: cardBg, zIndex: 25 }}
                        onDragOver={(e) => handleGroupDragOver(e, null)}
                        onDrop={(e) => handleGroupDrop(e, null)}
                        onDragLeave={() => setSidebarDragOverGroupId('ungrouped')}
                      >
                        <span className="text-[9px] font-semibold" style={{ color: sidebarDragHighlight(null) ? '#4caf50' : textMuted }}>Sin grupo</span>
                      </div>
                      <div className="flex-1" />
                    </div>
                  );
                }

                const task = row.task!;
                const startIdx = getDayIndex(task.start_date, viewStart);
                const endIdx = getDayIndex(task.end_date, viewStart);
                const duration = endIdx - startIdx;
                let taskLeft = startIdx * dayWidth;
                let taskWidth = Math.max(duration * dayWidth, dayWidth);

                if (dragging && dragging.taskId === task.id) {
                  const daysDelta = Math.round(dragDelta / dayWidth);
                  if (dragging.type === 'move') {
                    taskLeft = startIdx * dayWidth + daysDelta * dayWidth;
                  } else if (dragging.type === 'resize-left') {
                    taskLeft = startIdx * dayWidth + daysDelta * dayWidth;
                    taskWidth = Math.max(taskWidth - daysDelta * dayWidth, dayWidth);
                  } else if (dragging.type === 'resize-right') {
                    taskWidth = Math.max(taskWidth + daysDelta * dayWidth, dayWidth);
                  }
                }

                const bgColor = task.color || '#4caf50';
                const isLinkTarget = linkMode && linkMode.fromTaskId !== task.id;
                const isInvalid = hasInvalidDependencies(task);
                const errorMsg = isInvalid ? getDependencyErrorMessageForTask(task) : null;
                const isHovered = hoveredTask === task.id;
                const group = row.groupId ? groups.find(g => g.id === row.groupId) : null;
                const groupColor = group?.color || '#888';
                const groupBg = cardBg;

                return (
                  <div key={task.id} className="flex border-b" style={{ height: ROW_HEIGHT, borderBottom: `1px solid ${borderColor}` }}>
                    <div
                      className="flex-shrink-0 border-r flex items-center px-2 gap-1 cursor-pointer sticky left-0"
                      style={{
                        width: sidebarWidth,
                        borderColor,
                        backgroundColor: sidebarDragHighlight(row.groupId ?? null) ? hexToRgba(groupColor, 0.25) : groupBg,
                        borderLeft: `3px solid ${groupColor}`,
                        transition: 'background-color 0.15s ease, opacity 0.15s ease',
                        zIndex: 20,
                      }}
                      draggable
                      onDragStart={(e) => handleSidebarDragStart(e, task.id)}
                      onDragEnd={handleSidebarDragEnd}
                      onContextMenu={(e) => handleContextMenu(e, task.id)}
                    >
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: bgColor }} />
                      <span className="flex-1 text-[11px] font-medium truncate" style={{ color: textPrimary }}>
                        {task.name}
                      </span>
                      <span className="text-[9px] flex-shrink-0" style={{ color: textMuted }}>{task.estimate || ''}</span>
                      <button onClick={() => deleteTask(task.id)} className="text-gray-300 hover:text-red-500 text-[9px] font-bold flex-shrink-0">×</button>
                    </div>

                    <div className="flex-1 relative">
                      {calendarDays.map((day, i) => {
                        const dayOfWeek = day.getDay();
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                        return (
                          <div
                            key={i}
                            className="absolute top-0 h-full border-r"
                            style={{
                              left: i * dayWidth,
                              width: dayWidth,
                              borderColor,
                              backgroundColor: isWeekend ? (isDark ? '#252525' : '#f0f0f0') : i % 2 === 0 ? (isDark ? '#1e1e1e' : '#ffffff') : subtleBg,
                            }}
                          />
                        );
                      })}
                      <div
                        className="absolute rounded-[3px] select-none"
                        style={{
                          left: taskLeft + 2,
                          width: taskWidth - 4,
                          top: 8,
                          height: ROW_HEIGHT - 16,
                          backgroundColor: bgColor,
                          border: isLinkTarget ? '2px dashed #ff9800' : isInvalid ? '2px solid #f44336' : `1px solid ${darkenColor(bgColor, 0.7)}`,
                          cursor: dragging && dragging.taskId === task.id ? 'grabbing' : linkMode ? 'pointer' : 'grab',
                          zIndex: dragging && dragging.taskId === task.id ? 10 : 2,
                          opacity: linkMode && !isLinkTarget ? 0.6 : 1,
                          boxShadow: isInvalid ? '0 0 8px rgba(244, 67, 54, 0.6)' : isHovered ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                          transform: isHovered && !(dragging && dragging.taskId === task.id) ? 'scaleY(1.08)' : 'scaleY(1)',
                          transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                        }}
                        onMouseDown={(e) => {
                          if (linkMode) {
                            e.stopPropagation();
                            e.preventDefault();
                            if (linkMode.fromTaskId !== task.id) {
                              addDependency(task.id, linkMode.fromTaskId);
                              setLinkMode(null);
                            }
                            return;
                          }
                          handleMouseDown(e, task.id, 'move', task.start_date, task.end_date);
                        }}
                        onMouseEnter={() => setHoveredTask(task.id)}
                        onMouseLeave={() => setHoveredTask(null)}
                        onContextMenu={(e) => handleContextMenu(e, task.id)}
                      >
                        <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
                          <span className="text-[10px] font-bold text-white truncate px-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                            {task.name}
                          </span>
                        </div>
                        {isInvalid && isHovered && (
                          <div className="absolute z-20 px-2 py-1 rounded text-[10px] font-medium text-white whitespace-nowrap pointer-events-none"
                            style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4, backgroundColor: '#f44336' }}>
                            <TbAlertTriangle size={10} className="inline mr-1" />{errorMsg}
                          </div>
                        )}
                        {isInvalid && !isHovered && (
                          <div className="absolute flex items-center justify-center" style={{ top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', backgroundColor: '#f44336', zIndex: 11 }}>
                            <TbAlertTriangle size={9} className="text-white" />
                          </div>
                        )}
                        <div className="absolute left-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-l-[3px]"
                          onMouseDown={(e) => { if (!linkMode) handleMouseDown(e, task.id, 'resize-left', task.start_date, task.end_date); }} />
                        <div className="absolute right-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-r-[3px]"
                          onMouseDown={(e) => { if (!linkMode) handleMouseDown(e, task.id, 'resize-right', task.start_date, task.end_date); }} />
                      </div>
                    </div>
                  </div>
                );
              })}

              {renderArrows()}
            </div>

            {(() => {
              const todayIndex = differenceInDays(new Date(), viewStart);
              if (todayIndex < 0 || todayIndex >= numDays) return null;
              return (
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: sidebarWidth + todayIndex * dayWidth + dayWidth / 2, width: 2, backgroundColor: '#f44336', zIndex: 4 }}>
                  <div className="absolute -top-0 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white px-1 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: '#f44336' }}>
                    Hoy
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div ref={contextMenuRef} className="fixed z-50 border rounded-lg shadow-xl py-1 min-w-[200px] anim-context-menu" style={{ left: contextMenu.x, top: contextMenu.y, backgroundColor: cardBg, borderColor }}>
          <button className="w-full px-4 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={() => { setDetailModal({ taskId: contextMenu.taskId }); setContextMenu(null); }}>
            <TbFileText size={14} /> Detalles
          </button>
          <div className="border-t my-1" style={{ borderColor }} />
          {colorPickerFor === contextMenu.taskId ? (
            <div className="px-4 py-2">
              <div className="text-[10px] mb-2" style={{ color: textMuted }}>Color de la tarea</div>
              <div className="grid grid-cols-5 gap-1">
                {PRESET_COLORS.map(color => {
                  const task = tasks.find(t => t.id === contextMenu.taskId);
                  return (
                    <button key={color} className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform" style={{ backgroundColor: color, borderColor: task?.color === color ? '#333' : 'transparent' }} onClick={() => { updateTask(contextMenu.taskId, { color }); setContextMenu(null); setColorPickerFor(null); }} />
                  );
                })}
              </div>
            </div>
          ) : (
            <button className="w-full px-4 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={() => setColorPickerFor(contextMenu.taskId)}>
              <TbPalette size={14} /> Cambiar color
            </button>
          )}
          <div className="border-t my-1" style={{ borderColor }} />
          {(() => {
            const task = tasks.find(t => t.id === contextMenu.taskId);
            if (!task) return null;
            if (groups.length > 0) {
              return (
                <div className="px-4 py-2">
                  <div className="text-[10px] mb-1" style={{ color: textMuted }}>Grupo:</div>
                  <select className="w-full text-xs border rounded px-2 py-1" style={{ borderColor, backgroundColor: cardBg, color: textPrimary }} defaultValue={task.group_id || ''} onChange={(e) => { const val = e.target.value; updateTask(task.id, { group_id: val ? parseInt(val) : null }); setContextMenu(null); }}>
                    <option value="">Sin grupo</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              );
            }
            return null;
          })()}
          <button className="w-full px-4 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2" style={{ color: textPrimary }} onClick={() => { setLinkMode({ fromTaskId: contextMenu.taskId }); setContextMenu(null); }}>
            <TbLink size={14} /> Agregar dependencia
          </button>
          {tasks.find(t => t.id === contextMenu.taskId)?.dependencies && tasks.find(t => t.id === contextMenu.taskId)!.dependencies.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-[10px] mb-1" style={{ color: textMuted }}>Dependencias:</div>
              {tasks.find(t => t.id === contextMenu.taskId)!.dependencies.map(depId => {
                const depTask = tasks.find(t => t.id === depId);
                if (!depTask) return null;
                return (
                  <div key={depId} className="flex items-center justify-between text-[11px] py-1">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: depTask.color || '#4caf50' }} />{depTask.name}</span>
                    <button className="text-red-400 hover:text-red-600 text-[10px] font-bold" onClick={async () => { await fetch(`${API_URL}/tasks/${contextMenu.taskId}/dependencies/${depId}`, { method: 'DELETE' }); await fetchTasks(); }}><TbX size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t my-1" style={{ borderColor }} />
          <button className="w-full px-4 py-2 text-left text-xs hover:bg-red-50 text-red-500 flex items-center gap-2" onClick={() => { deleteTask(contextMenu.taskId); setContextMenu(null); }}>
            <TbTrash size={14} /> Eliminar tarea
          </button>
        </div>
      )}

      {groupContextMenu && (
        <div ref={groupContextMenuRef} className="fixed z-50 border rounded-lg shadow-xl py-1 min-w-[200px] anim-context-menu" style={{ left: groupContextMenu.x, top: groupContextMenu.y, backgroundColor: cardBg, borderColor }}>
          <button
            className="w-full px-4 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2"
            style={{ color: textPrimary }}
            onClick={() => {
              setEditingGroupId(groupContextMenu.groupId);
              setGroupContextMenu(null);
            }}
          >
            <TbFileText size={14} /> Cambiar nombre
          </button>
          <div className="border-t my-1" style={{ borderColor }} />
          {groupColorPickerFor === groupContextMenu.groupId ? (
            <div className="px-4 py-2">
              <div className="text-[10px] mb-2" style={{ color: textMuted }}>Color del grupo</div>
              <div className="grid grid-cols-5 gap-1">
                {PRESET_COLORS.map(color => {
                  const grp = groups.find(g => g.id === groupContextMenu.groupId);
                  return (
                    <button
                      key={color}
                      className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color, borderColor: grp?.color === color ? '#333' : 'transparent' }}
                      onClick={() => {
                        updateGroup(groupContextMenu.groupId, { color });
                        setGroupContextMenu(null);
                        setGroupColorPickerFor(null);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              className="w-full px-4 py-2 text-left text-xs hover:opacity-80 flex items-center gap-2"
              style={{ color: textPrimary }}
              onClick={() => setGroupColorPickerFor(groupContextMenu.groupId)}
            >
              <TbPalette size={14} /> Cambiar color
            </button>
          )}
          <div className="border-t my-1" style={{ borderColor }} />
          <button
            className="w-full px-4 py-2 text-left text-xs hover:bg-red-50 text-red-500 flex items-center gap-2"
            onClick={() => {
              deleteGroup(groupContextMenu.groupId);
              setGroupContextMenu(null);
            }}
          >
            <TbTrash size={14} /> Eliminar grupo
          </button>
        </div>
      )}

      {(() => {
        if (!previewAttachment) return null;
        const att = previewAttachment;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 anim-overlay" onClick={() => setPreviewAttachment(null)} tabIndex={0} ref={(el) => el?.focus()}>
            <div className="relative max-w-[90vw] max-h-[85vh] anim-lightbox" onClick={(e) => e.stopPropagation()}>
              {getFileCategory(att.file_type, att.file_name) === '3d' ? (
                <div className="w-[80vw] h-[70vh] rounded-lg overflow-hidden shadow-2xl bg-[#1a1a1a]">
                  <Viewer3D src={att.file_data} fileName={att.file_name} />
                </div>
              ) : (
                <img src={att.file_data} alt={att.file_name} className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain" />
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-4 py-2 rounded-b-lg">
                <div className="text-xs text-white text-center truncate">{att.file_name}</div>
              </div>
              <button className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 rounded-full p-1.5 text-white transition-colors" onClick={() => setPreviewAttachment(null)}>
                <TbX size={16} />
              </button>
            </div>
          </div>
        );
      })()}

      {detailModal && (() => {
        const task = tasks.find(t => t.id === detailModal.taskId);
        if (!task) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 anim-overlay" onClick={() => setDetailModal(null)}>
            <div className="rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-y-auto anim-modal" style={{ backgroundColor: cardBg }} onClick={(e) => e.stopPropagation()}>
              <div className="px-6 py-4 rounded-t-xl flex items-center justify-between" style={{ backgroundColor: hexToRgba(task.color || '#4caf50', 0.15) }}>
                <h2 className="text-sm font-bold" style={{ color: darkenColor(task.color || '#4caf50', 0.6) }}>Detalles de la tarea</h2>
                <button className="text-lg font-bold" style={{ color: textMuted }} onClick={() => setDetailModal(null)}><TbX size={18} /></button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Nombre</label>
                  <input className="w-full mt-1 px-3 py-2 text-xs border rounded-lg outline-none" style={{ borderColor, backgroundColor: subtleBg, color: textPrimary }} defaultValue={task.name} onBlur={(e) => { if (e.target.value !== task.name) updateTask(task.id, { name: e.target.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                </div>
                <div ref={dropZoneRef} className={`relative rounded-lg transition-colors ${dragOverTaskId === task.id ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`} onDragEnter={(e) => { e.preventDefault(); setDragOverTaskId(task.id); }} onDragOver={(e) => { e.preventDefault(); setDragOverTaskId(task.id); }} onDragLeave={() => setDragOverTaskId(null)} onDrop={(e) => handleDropZone(e, task.id)}>
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Notas</label>
                  <textarea className="w-full mt-1 px-3 py-2 text-xs border rounded-lg outline-none min-h-[60px] resize-y" style={{ borderColor, backgroundColor: subtleBg, color: textPrimary }} defaultValue={task.notes || ''} placeholder="Agregar notas..." onBlur={(e) => updateTask(task.id, { notes: e.target.value })} onPaste={(e) => handlePasteToAttachments(e, task.id)} />
                  <div className="flex items-center gap-2 mt-2">
                    <button className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-gray-600" style={{ backgroundColor: isDark ? '#3a3a3a' : '#f0f0f0' }} onClick={() => handleAttachFile(task.id)}>
                      <TbPaperclip size={12} /> Adjuntar archivo
                    </button>
                  </div>
                  {Object.keys(uploadProgress).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {Object.entries(uploadProgress).map(([key, pct]) => (
                        <div key={key}>
                          <div className="flex items-center justify-between text-[10px] mb-0.5" style={{ color: textMuted }}>
                            <span className="truncate max-w-[280px]">{key.split('-').slice(0, -1).join('-')}</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0' }}>
                            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#4caf50' : '#2196f3' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1 text-[10px]" style={{ color: textMuted }}>
                    <TbPhoto size={12} /> Arrastrá archivos aquí o pegá imágenes con Ctrl+V
                  </div>
                </div>
                {task.attachments && task.attachments.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Archivos adjuntos ({task.attachments.length})</label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {task.attachments.map((att) => {
                        const cat = getFileCategory(att.file_type, att.file_name);
                        if (cat === 'image') {
                          return (
                            <div key={att.id} className="relative group cursor-pointer rounded-lg overflow-hidden border" style={{ borderColor, backgroundColor: subtleBg }}>
                              <img src={att.file_data} alt={att.file_name} className="w-full h-20 object-cover" onClick={() => setPreviewAttachment(att)} />
                              <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5"><div className="text-[8px] text-white truncate">{att.file_name}</div></div>
                              <button className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id); }}><TbX size={10} className="text-white" /></button>
                            </div>
                          );
                        }
                        if (cat === 'video') {
                          return (
                            <div key={att.id} className="relative group rounded-lg overflow-hidden border bg-black" style={{ borderColor }}>
                              <video src={att.file_data} controls className="w-full h-20 object-cover" />
                              <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5"><div className="text-[8px] text-white truncate">{att.file_name}</div></div>
                              <button className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id); }}><TbX size={10} className="text-white" /></button>
                            </div>
                          );
                        }
                        if (cat === 'audio') {
                          return (
                            <div key={att.id} className="relative group rounded-lg overflow-hidden border p-2" style={{ borderColor, backgroundColor: subtleBg }}>
                              <div className="flex items-center gap-1 mb-1"><TbPaperclip size={12} style={{ color: textMuted }} /><span className="text-[9px] truncate" style={{ color: textMuted }}>{att.file_name}</span></div>
                              <audio src={att.file_data} controls className="w-full h-8" />
                              <button className="absolute top-1 right-1 bg-white border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id); }}><TbX size={10} className="text-gray-500" /></button>
                            </div>
                          );
                        }
                        if (cat === '3d') {
                          return (
                            <div key={att.id} className="relative group rounded-lg overflow-hidden border cursor-pointer" style={{ borderColor, backgroundColor: '#1a1a1a' }} onClick={() => setPreviewAttachment(att)}>
                              <div style={{ width: '100%', height: '80px' }}><Viewer3D src={att.file_data} fileName={att.file_name} /></div>
                              <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5"><div className="text-[8px] text-white truncate">{att.file_name}</div></div>
                              <button className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id); }}><TbX size={10} className="text-white" /></button>
                            </div>
                          );
                        }
                        return (
                          <div key={att.id} className="relative group rounded-lg overflow-hidden border p-2" style={{ borderColor, backgroundColor: subtleBg }}>
                            <div className="flex items-center gap-1"><TbPaperclip size={12} style={{ color: textMuted }} /><span className="text-[9px] truncate" style={{ color: textSecondary }}>{att.file_name}</span></div>
                            <div className="flex gap-1 mt-1"><a href={att.file_data} download={att.file_name} className="text-[9px] text-blue-500 hover:underline flex items-center gap-0.5"><TbDownload size={10} /> Descargar</a></div>
                            <button className="absolute top-1 right-1 bg-white border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id); }}><TbX size={10} className="text-gray-500" /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Inicio</label>
                    <input type="date" className="w-full mt-1 px-3 py-2 text-xs border rounded-lg outline-none" style={{ borderColor, backgroundColor: subtleBg, color: textPrimary }} defaultValue={task.start_date} onChange={(e) => updateTask(task.id, { start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Fin</label>
                    <input type="date" className="w-full mt-1 px-3 py-2 text-xs border rounded-lg outline-none" style={{ borderColor, backgroundColor: subtleBg, color: textPrimary }} defaultValue={task.end_date} onChange={(e) => updateTask(task.id, { end_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Estado</label>
                  <select className="w-full mt-1 px-3 py-2 text-xs border rounded-lg outline-none" style={{ borderColor, backgroundColor: subtleBg, color: textPrimary }} defaultValue={task.status || 'pendiente'} onChange={(e) => updateTask(task.id, { status: e.target.value })}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {PRESET_COLORS.map(color => (
                      <button key={color} className="w-7 h-7 rounded-full border-2 hover:scale-110 transition-transform" style={{ backgroundColor: color, borderColor: task.color === color ? '#333' : 'transparent' }} onClick={() => updateTask(task.id, { color })} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: textMuted }}>Dependencias ({task.dependencies?.length || 0})</label>
                  {task.dependencies && task.dependencies.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {task.dependencies.map(depId => {
                        const depTask = tasks.find(t => t.id === depId);
                        if (!depTask) return null;
                        return (
                          <div key={depId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ backgroundColor: subtleBg }}>
                            <span className="flex items-center gap-2 text-xs">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: depTask.color || '#4caf50' }} />
                              {depTask.name}
                            </span>
                            <button className="text-red-400 hover:text-red-600 text-xs font-bold" onClick={async () => { await fetch(`${API_URL}/tasks/${task.id}/dependencies/${depId}`, { method: 'DELETE' }); await fetchTasks(); }}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-[11px] mt-2" style={{ color: textMuted }}>Sin dependencias</p>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}