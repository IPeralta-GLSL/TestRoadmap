import { useEffect, useState } from 'react';
import { TbX, TbEdit, TbTrash, TbPlus, TbRefresh, TbClock } from 'react-icons/tb';

interface GlobalChangeEvent {
  id: number;
  task_id: number;
  timestamp: string;
  change_type: string;
  diff: any;
  snapshot: any;
}

interface GlobalHistoryState {
  isOpen: boolean;
  events: GlobalChangeEvent[];
  loading: boolean;
}

export default function GlobalHistory({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [state, setState] = useState<GlobalHistoryState>({
    isOpen,
    events: [],
    loading: false,
  });

  const fetchGlobalHistory = async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/tasks/versions/all');
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({
          ...prev,
          events: data.sort((a: GlobalChangeEvent, b: GlobalChangeEvent) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          ),
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchGlobalHistory();
    }
  }, [isOpen]);

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'create':
        return <TbPlus size={16} className="text-green-600" />;
      case 'update':
        return <TbEdit size={16} className="text-blue-600" />;
      case 'delete':
        return <TbTrash size={16} className="text-red-600" />;
      case 'restore':
        return <TbRefresh size={16} className="text-purple-600" />;
      default:
        return <TbClock size={16} className="text-gray-600" />;
    }
  };

  const getChangeLabel = (type: string) => {
    switch (type) {
      case 'create':
        return 'Creado';
      case 'update':
        return 'Actualizado';
      case 'delete':
        return 'Eliminado';
      case 'restore':
        return 'Restaurado';
      default:
        return 'Cambio';
    }
  };

  const getChangeColor = (type: string) => {
    switch (type) {
      case 'create':
        return 'bg-green-50 border-green-200';
      case 'update':
        return 'bg-blue-50 border-blue-200';
      case 'delete':
        return 'bg-red-50 border-red-200';
      case 'restore':
        return 'bg-purple-50 border-purple-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getTaskName = (snapshot: any) => {
    return snapshot?.name || 'Tarea sin nombre';
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Hace unos segundos';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    
    return date.toLocaleString('es-AR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden bg-white flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TbClock size={20} className="text-gray-700" />
            <h2 className="text-lg font-bold text-gray-900">Historial de cambios</h2>
          </div>
          <button
            className="text-gray-500 hover:text-gray-700 transition-colors"
            onClick={onClose}
          >
            <TbX size={20} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {state.loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin">
                <TbRefresh size={24} className="text-gray-400" />
              </div>
            </div>
          ) : state.events.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <TbClock size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Sin cambios registrados aún</p>
            </div>
          ) : (
            <div className="space-y-3">
              {state.events.map((event, idx) => (
                <div key={event.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`p-2 rounded-full ${
                      event.change_type === 'create' ? 'bg-green-100' :
                      event.change_type === 'update' ? 'bg-blue-100' :
                      event.change_type === 'delete' ? 'bg-red-100' :
                      event.change_type === 'restore' ? 'bg-purple-100' :
                      'bg-gray-100'
                    }`}>
                      {getChangeIcon(event.change_type)}
                    </div>
                    {idx < state.events.length - 1 && (
                      <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                    )}
                  </div>

                  <div className="flex-1 pt-1">
                    <div className={`p-3 rounded-lg border-2 ${getChangeColor(event.change_type)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-gray-900">
                              {getChangeLabel(event.change_type)}
                            </span>
                            <span className="text-xs text-gray-600 font-mono">
                              #{event.task_id}
                            </span>
                          </div>
                          <p className="text-sm text-gray-800 mb-1">
                            <span className="font-medium">{getTaskName(event.snapshot)}</span>
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatTime(event.timestamp)}
                          </p>
                        </div>
                      </div>

                      {event.diff && Object.keys(event.diff).length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-300/50 text-xs text-gray-600">
                          <div className="space-y-1">
                            {Object.entries(event.diff).map(([key, value]: [string, any]) => {
                              if (Array.isArray(value) && value.length === 2) {
                                return (
                                  <div key={key} className="flex items-start gap-2">
                                    <span className="font-mono text-gray-700 min-w-[80px]">{key}:</span>
                                    <div className="flex-1">
                                      <div className="text-red-600 line-through opacity-60">
                                        {String(value[0])}
                                      </div>
                                      <div className="text-green-600">
                                        {String(value[1])}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
