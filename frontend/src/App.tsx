import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { TbX, TbFileText, TbPalette, TbLink, TbTrash } from 'react-icons/tb';
import { Task } from './types/Task';
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

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  });
  const [dayWidth, setDayWidth] = useState(DAY_WIDTH_DEFAULT);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const calendarContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [linkMode, setLinkMode] = useState<{ fromTaskId: number } | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; time: number; button: number } | null>(null);

  const numDays = 60;

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tasks`);
      const data: Task[] = await res.json();
      setTasks(data);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const socket: Socket = io(window.location.origin, {
      path: '/socket.io',
    });

    socket.on('connect', () => {
      console.log('Connected to server');
    });

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
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const addTask = async () => {
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
        }),
      });
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  const deleteTask = async (id: number) => {
    try {
      await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
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

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
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
      setDragDelta(delta);
    };

      const handleMouseUp = () => {
        if (dragStartRef.current) {
          const elapsed = Date.now() - dragStartRef.current.time;
          const button = dragStartRef.current.button;
          dragStartRef.current = null;

          if (elapsed < 200 && Math.abs(dragDelta) < 3 && button === 0) {
            if (linkMode) {
              if (linkMode.fromTaskId !== dragging.taskId) {
                addDependency(dragging.taskId, linkMode.fromTaskId);
              }
              setLinkMode(null);
            } else {
              setDetailModal({ taskId: dragging.taskId });
            }
          }
        }

      const daysDelta = Math.round(dragDelta / dayWidth);
      if (daysDelta !== 0 && dragging) {
        const task = tasks.find((t) => t.id === dragging.taskId);
        if (!task) return;

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
      setDragging(null);
      setDragDelta(0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragDelta, dayWidth, tasks, linkMode]);

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

  const getTaskRects = () => {
    return tasks.map((task) => {
      const startIdx = getDayIndex(task.start_date, viewStart);
      const endIdx = getDayIndex(task.end_date, viewStart);
      const duration = endIdx - startIdx;
      const left = startIdx * dayWidth;
      const width = Math.max(duration * dayWidth, dayWidth);

      let currentLeft = left;
      let currentWidth = width;
      if (dragging && dragging.taskId === task.id) {
        const daysDelta = Math.round(dragDelta / dayWidth);
        if (dragging.type === 'move') {
          currentLeft = left + daysDelta * dayWidth;
        } else if (dragging.type === 'resize-left') {
          currentLeft = left + daysDelta * dayWidth;
          currentWidth = width - daysDelta * dayWidth;
        } else if (dragging.type === 'resize-right') {
          currentWidth = width + daysDelta * dayWidth;
        }
      }

      const taskIndex = tasks.indexOf(task);
      const top = taskIndex * ROW_HEIGHT + 8;
      const height = ROW_HEIGHT - 16;

      return { task, left: currentLeft, width: currentWidth, top, height };
    });
  };

  const renderArrows = () => {
    const rects = getTaskRects();
    const arrows: React.ReactNode[] = [];

    tasks.forEach((task) => {
      if (!task.dependencies) return;
      const taskRect = rects.find(r => r.task.id === task.id);
      if (!taskRect) return;

      task.dependencies.forEach(depId => {
        const depRect = rects.find(r => r.task.id === depId);
        if (!depRect) return;

        const fromX = depRect.left + depRect.width;
        const fromY = depRect.top + depRect.height / 2;
        const toX = taskRect.left;
        const toY = taskRect.top + taskRect.height / 2;

        const midX = fromX + (toX - fromX) / 2;

        arrows.push(
          <path
            key={`${task.id}-${depId}`}
            d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
            stroke={darkenColor(task.color || '#4caf50', 0.6)}
            strokeWidth={2}
            fill="none"
            markerEnd={`url(#arrowhead-${task.id})`}
          />
        );
      });
    });

    const markerTasks = tasks.filter(t => t.dependencies && t.dependencies.length > 0);

    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        <defs>
          {markerTasks.map(task => (
            <marker
              key={`marker-${task.id}`}
              id={`arrowhead-${task.id}`}
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill={darkenColor(task.color || '#4caf50', 0.6)} />
            </marker>
          ))}
        </defs>
        {arrows}
      </svg>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-[#f5f5f5]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] bg-white">
        <h1 className="text-base font-semibold tracking-tight">Roadmapper</h1>
        <div className="flex items-center gap-2">
          {linkMode && (
            <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded">
              Haz click en una tarea destino para crear la dependencia
              <button
                onClick={() => setLinkMode(null)}
                className="ml-2 text-orange-800 font-bold"
              >
                ✕
              </button>
            </span>
          )}
          <button
            onClick={() => setDayWidth(Math.max(DAY_WIDTH_MIN, dayWidth - 15))}
            className="px-2 py-1 text-xs bg-[#e0e0e0] hover:bg-[#d0d0d0] rounded"
          >
            −
          </button>
          <span className="text-xs text-gray-500 w-16 text-center">{dayWidth}px</span>
          <button
            onClick={() => setDayWidth(Math.min(DAY_WIDTH_MAX, dayWidth + 15))}
            className="px-2 py-1 text-xs bg-[#e0e0e0] hover:bg-[#d0d0d0] rounded"
          >
            +
          </button>
          <button
            onClick={addTask}
            className="ml-4 px-3 py-1 text-xs bg-[#4caf50] hover:bg-[#43a047] text-white rounded font-medium"
          >
            + Nueva tarea
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 border-r border-[#e0e0e0] bg-white flex-shrink-0 overflow-y-auto">
          <div className="h-14 border-b border-[#e0e0e0] bg-[#fafafa] flex items-end px-2">
            <span className="text-[10px] text-gray-400 font-medium pb-1">Tarea</span>
          </div>
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center border-b border-[#e0e0e0] px-2"
              style={{ height: ROW_HEIGHT }}
            >
              <div
                className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
                style={{ backgroundColor: task.color || '#4caf50' }}
              />
              <input
                className="flex-1 text-xs font-medium bg-transparent border-none outline-none"
                defaultValue={task.name}
                onBlur={(e) => {
                  if (e.target.value !== task.name) {
                    updateTask(task.id, { name: e.target.value });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <input
                className="w-14 text-[10px] text-gray-400 bg-transparent border-none outline-none text-right"
                defaultValue={task.estimate || ''}
                placeholder="est."
                onBlur={(e) => {
                  if (e.target.value !== (task.estimate || '')) {
                    updateTask(task.id, { estimate: e.target.value });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <button
                onClick={() => deleteTask(task.id)}
                className="ml-1 text-gray-300 hover:text-red-500 text-xs font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div
          className="flex-1 overflow-x-auto overflow-y-auto"
          ref={scrollRef}
        >
          <div
            className="relative"
            ref={calendarContainerRef}
            style={{ minWidth: numDays * dayWidth }}
          >
            <div className="flex border-b border-[#e0e0e0] bg-[#fafafa] sticky top-0 z-10">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex" style={{ width: week.days.length * dayWidth }}>
                  <div
                    className="text-[10px] text-gray-400 font-medium px-1 py-1"
                    style={{ width: week.days.length * dayWidth }}
                  >
                    {format(week.weekStart, 'MMM yyyy', { locale: es })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex border-b border-[#e0e0e0] bg-[#fafafa] sticky top-0 z-10">
              {calendarDays.map((day, i) => {
                const dayOfWeek = day.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                return (
                  <div
                    key={i}
                    className="text-center border-r border-[#e0e0e0]"
                    style={{
                      width: dayWidth,
                      backgroundColor: isWeekend ? '#f0f0f0' : '#fafafa',
                    }}
                  >
                    <div className="text-[10px] text-gray-400">{dayNames[(dayOfWeek + 6) % 7]}</div>
                    <div className="text-[10px] font-medium">{format(day, 'd')}</div>
                  </div>
                );
              })}
            </div>

            <div className="relative" style={{ height: tasks.length * ROW_HEIGHT }}>
              {tasks.map((task, taskIdx) => {
                const startIdx = getDayIndex(task.start_date, viewStart);
                const endIdx = getDayIndex(task.end_date, viewStart);
                const duration = endIdx - startIdx;
                const left = startIdx * dayWidth;
                const width = Math.max(duration * dayWidth, dayWidth);

                let currentLeft = left;
                let currentWidth = width;
                if (dragging && dragging.taskId === task.id) {
                  const daysDelta = Math.round(dragDelta / dayWidth);
                  if (dragging.type === 'move') {
                    currentLeft = left + daysDelta * dayWidth;
                  } else if (dragging.type === 'resize-left') {
                    currentLeft = left + daysDelta * dayWidth;
                    currentWidth = width - daysDelta * dayWidth;
                  } else if (dragging.type === 'resize-right') {
                    currentWidth = width + daysDelta * dayWidth;
                  }
                }

                const bgColor = task.color || '#4caf50';
                const borderColor = darkenColor(bgColor, 0.7);
                const isLinkTarget = linkMode && linkMode.fromTaskId !== task.id;

                return (
                  <div
                    key={task.id}
                    className="absolute left-0 w-full"
                    style={{ top: taskIdx * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                  >
                    {calendarDays.map((day, i) => {
                      const dayOfWeek = day.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      return (
                        <div
                          key={i}
                          className="absolute top-0 h-full border-r border-[#e0e0e0]"
                          style={{
                            left: i * dayWidth,
                            width: dayWidth,
                            backgroundColor: isWeekend ? '#f0f0f0' : i % 2 === 0 ? '#ffffff' : '#fafafa',
                          }}
                        />
                      );
                    })}

                    <div
                      className="absolute rounded-[3px] select-none"
                      style={{
                        left: currentLeft + 2,
                        width: currentWidth - 4,
                        top: 8,
                        height: ROW_HEIGHT - 16,
                        backgroundColor: bgColor,
                        border: isLinkTarget ? `2px dashed #ff9800` : `1px solid ${borderColor}`,
                        cursor: dragging && dragging.taskId === task.id ? 'grabbing' : linkMode ? 'pointer' : 'grab',
                        zIndex: dragging && dragging.taskId === task.id ? 10 : 2,
                        opacity: linkMode && !isLinkTarget ? 0.6 : 1,
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
                    >
                      <div
                        className="absolute left-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-l-[3px]"
                        onMouseDown={(e) => {
                          if (linkMode) return;
                          handleMouseDown(e, task.id, 'resize-left', task.start_date, task.end_date);
                        }}
                      />
                      <div
                        className="absolute right-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-r-[3px]"
                        onMouseDown={(e) => {
                          if (linkMode) return;
                          handleMouseDown(e, task.id, 'resize-right', task.start_date, task.end_date);
                        }}
                      />
                      <div
                        className="absolute inset-0 flex items-center justify-center px-3 overflow-hidden"
                        style={{ pointerEvents: 'none' }}
                      >
                        <span
                          className="text-[11px] font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis"
                          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                        >
                          {task.name} ({task.status || 'pendiente'})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {renderArrows()}

              {(() => {
                const todayIndex = differenceInDays(new Date(), viewStart);
                if (todayIndex < 0 || todayIndex >= numDays) return null;
                return (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: todayIndex * dayWidth + dayWidth / 2,
                      width: 2,
                      backgroundColor: '#f44336',
                      zIndex: 4,
                    }}
                  >
                    <div
                      className="absolute -top-0 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white px-1 py-0.5 rounded whitespace-nowrap"
                      style={{ backgroundColor: '#f44336' }}
                    >
                      Hoy
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border border-[#e0e0e0] rounded-lg shadow-xl py-1 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-2 text-left text-xs hover:bg-[#f0f0f0] flex items-center gap-2"
            onClick={() => {
              setDetailModal({ taskId: contextMenu.taskId });
              setContextMenu(null);
            }}
          >
            <TbFileText size={14} /> Detalles
          </button>

          <div className="border-t border-[#e0e0e0] my-1" />

          {colorPickerFor === contextMenu.taskId ? (
            <div className="px-4 py-2">
              <div className="text-[10px] text-gray-400 mb-2">Color de la tarea</div>
              <div className="grid grid-cols-5 gap-1">
                {PRESET_COLORS.map(color => {
                  const task = tasks.find(t => t.id === contextMenu.taskId);
                  return (
                    <button
                      key={color}
                      className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                      style={{
                        backgroundColor: color,
                        borderColor: task?.color === color ? '#333' : 'transparent',
                      }}
                      onClick={() => {
                        updateTask(contextMenu.taskId, { color });
                        setContextMenu(null);
                        setColorPickerFor(null);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              className="w-full px-4 py-2 text-left text-xs hover:bg-[#f0f0f0] flex items-center gap-2"
              onClick={() => {
                setColorPickerFor(contextMenu.taskId);
              }}
            >
              <TbPalette size={14} /> Cambiar color
            </button>
          )}

          <div className="border-t border-[#e0e0e0] my-1" />

          <button
            className="w-full px-4 py-2 text-left text-xs hover:bg-[#f0f0f0] flex items-center gap-2"
            onClick={() => {
              setLinkMode({ fromTaskId: contextMenu.taskId });
              setContextMenu(null);
            }}
          >
            <TbLink size={14} /> Agregar dependencia
          </button>

          {tasks.find(t => t.id === contextMenu.taskId)?.dependencies &&
           tasks.find(t => t.id === contextMenu.taskId)!.dependencies.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-[10px] text-gray-400 mb-1">Dependencias:</div>
              {tasks.find(t => t.id === contextMenu.taskId)!.dependencies.map(depId => {
                const depTask = tasks.find(t => t.id === depId);
                if (!depTask) return null;
                return (
                  <div key={depId} className="flex items-center justify-between text-[11px] py-1">
                    <span className="flex items-center gap-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: depTask.color || '#4caf50' }}
                      />
                      {depTask.name}
                    </span>
                     <button
                       className="text-red-400 hover:text-red-600 text-[10px] font-bold"
                       onClick={async () => {
                         try {
                           await fetch(`${API_URL}/tasks/${contextMenu.taskId}/dependencies/${depId}`, {
                             method: 'DELETE',
                           });
                           await fetchTasks();
                         } catch (err) {
                           console.error('Error removing dependency:', err);
                         }
                       }}
                     >
                       <TbX size={12} />
                     </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-[#e0e0e0] my-1" />

          <button
            className="w-full px-4 py-2 text-left text-xs hover:bg-red-50 text-red-500 flex items-center gap-2"
            onClick={() => {
              deleteTask(contextMenu.taskId);
              setContextMenu(null);
            }}
          >
            <TbTrash size={14} /> Eliminar tarea
          </button>
        </div>
      )}

      {detailModal && (() => {
        const task = tasks.find(t => t.id === detailModal.taskId);
        if (!task) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setDetailModal(null)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="px-6 py-4 rounded-t-xl flex items-center justify-between"
                style={{ backgroundColor: hexToRgba(task.color || '#4caf50', 0.15) }}
              >
                <h2 className="text-sm font-bold" style={{ color: darkenColor(task.color || '#4caf50', 0.6) }}>
                  Detalles de la tarea
                </h2>
                <button
                  className="text-gray-400 hover:text-gray-600 text-lg font-bold"
                  onClick={() => setDetailModal(null)}
                >
                  <TbX size={18} />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Nombre</label>
                  <input
                    className="w-full mt-1 px-3 py-2 text-xs border border-[#e0e0e0] rounded-lg outline-none focus:border-[#4caf50]"
                    defaultValue={task.name}
                    onBlur={(e) => {
                      if (e.target.value !== task.name) {
                        updateTask(task.id, { name: e.target.value });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Inicio</label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 text-xs border border-[#e0e0e0] rounded-lg outline-none focus:border-[#4caf50]"
                      defaultValue={task.start_date}
                      onChange={(e) => {
                        updateTask(task.id, { start_date: e.target.value });
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Fin</label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 text-xs border border-[#e0e0e0] rounded-lg outline-none focus:border-[#4caf50]"
                      defaultValue={task.end_date}
                      onChange={(e) => {
                        updateTask(task.id, { end_date: e.target.value });
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Nota</label>
                  <input
                    className="w-full mt-1 px-3 py-2 text-xs border border-[#e0e0e0] rounded-lg outline-none focus:border-[#4caf50]"
                    defaultValue={task.estimate || ''}
                    placeholder="Agregar nota..."
                    onBlur={(e) => {
                      updateTask(task.id, { estimate: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>

                <div>
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Estado</label>
                  <select
                    className="w-full mt-1 px-3 py-2 text-xs border border-[#e0e0e0] rounded-lg outline-none focus:border-[#4caf50]"
                    defaultValue={task.status || 'pendiente'}
                    onChange={(e) => {
                      updateTask(task.id, { status: e.target.value });
                    }}
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color}
                        className="w-7 h-7 rounded-full border-2 hover:scale-110 transition-transform"
                        style={{
                          backgroundColor: color,
                          borderColor: task.color === color ? '#333' : 'transparent',
                        }}
                        onClick={() => {
                          updateTask(task.id, { color });
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                    Dependencias ({task.dependencies?.length || 0})
                  </label>
                  {task.dependencies && task.dependencies.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {task.dependencies.map(depId => {
                        const depTask = tasks.find(t => t.id === depId);
                        if (!depTask) return null;
                        return (
                          <div key={depId} className="flex items-center justify-between px-3 py-2 bg-[#fafafa] rounded-lg">
                            <span className="flex items-center gap-2 text-xs">
                              <div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: depTask.color || '#4caf50' }}
                              />
                              {depTask.name}
                            </span>
                            <button
                              className="text-red-400 hover:text-red-600 text-xs font-bold"
                              onClick={async () => {
                                await fetch(`${API_URL}/tasks/${task.id}/dependencies/${depId}`, {
                                  method: 'DELETE',
                                });
                                await fetchTasks();
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-2">Sin dependencias</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}