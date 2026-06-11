import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Task } from './types/Task';
import { addDays, format, parseISO, differenceInDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

const API_URL = '/api';
const DAY_WIDTH_MIN = 30;
const DAY_WIDTH_DEFAULT = 60;
const ROW_HEIGHT = 48;

function getDayIndex(dateStr: string, viewStart: Date): number {
  const d = parseISO(dateStr);
  return differenceInDays(d, viewStart);
}

interface DragState {
  taskId: number;
  type: 'move' | 'resize-left' | 'resize-right';
  startX: number;
  origStart: string;
  origEnd: string;
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
      setTasks((prev) => [...prev, task]);
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
      await fetch(`${API_URL}/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  const handleMouseDown = (
    e: React.MouseEvent,
    taskId: number,
    type: 'move' | 'resize-left' | 'resize-right',
    origStart: string,
    origEnd: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging({ taskId, type, startX: e.clientX, origStart, origEnd });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragging.startX;
      setDragDelta(delta);
    };

    const handleMouseUp = () => {
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

        updateTask(task.id, { ...task, start_date: newStart, end_date: newEnd });
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
  }, [dragging, dragDelta, dayWidth, tasks]);

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

  return (
    <div className="h-screen flex flex-col bg-[#f5f5f5]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] bg-white">
        <h1 className="text-base font-semibold tracking-tight">Roadmapper</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDayWidth(Math.max(DAY_WIDTH_MIN, dayWidth - 15))}
            className="px-2 py-1 text-xs bg-[#e0e0e0] hover:bg-[#d0d0d0] rounded"
          >
            −
          </button>
          <span className="text-xs text-gray-500 w-16 text-center">{dayWidth}px</span>
          <button
            onClick={() => setDayWidth(Math.min(120, dayWidth + 15))}
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
              <input
                className="flex-1 text-xs font-medium bg-transparent border-none outline-none"
                defaultValue={task.name}
                onBlur={(e) => {
                  if (e.target.value !== task.name) {
                    updateTask(task.id, { ...task, name: e.target.value });
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
                    updateTask(task.id, { ...task, estimate: e.target.value });
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

        <div className="flex-1 overflow-x-auto overflow-y-auto" ref={scrollRef}>
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

          {tasks.map((task) => {
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

            return (
              <div
                key={task.id}
                className="relative border-b border-[#e0e0e0]"
                style={{ height: ROW_HEIGHT }}
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
                  className="absolute rounded-[3px] cursor-grab active:cursor-grabbing select-none"
                  style={{
                    left: currentLeft + 2,
                    width: currentWidth - 4,
                    top: 8,
                    height: ROW_HEIGHT - 16,
                    backgroundColor: '#4caf50',
                    border: '1px solid #388e3c',
                  }}
                  onMouseDown={(e) =>
                    handleMouseDown(e, task.id, 'move', task.start_date, task.end_date)
                  }
                >
                  <div
                    className="absolute left-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-l-[3px]"
                    onMouseDown={(e) =>
                      handleMouseDown(e, task.id, 'resize-left', task.start_date, task.end_date)
                    }
                  />
                  <div
                    className="absolute right-0 top-0 w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-r-[3px]"
                    onMouseDown={(e) =>
                      handleMouseDown(e, task.id, 'resize-right', task.start_date, task.end_date)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}