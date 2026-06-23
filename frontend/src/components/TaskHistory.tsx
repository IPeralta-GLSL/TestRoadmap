import { useEffect, useState } from 'react';
import { TbClock, TbRotateClockwise2 } from 'react-icons/tb';

interface VersionSummary {
  id: number;
  task_id: number;
  user_id: string | null;
  timestamp: string;
  change_type: string;
}

const renderDiffValue = (value: any) => {
  if (Array.isArray(value) && value.length === 2) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Antes</span>
          <span className="text-xs text-gray-700 font-mono">{String(value[0])}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Después</span>
          <span className="text-xs text-gray-700 font-mono">{String(value[1])}</span>
        </div>
      </div>
    );
  }
  return <span className="text-xs text-gray-600 font-mono">{String(value)}</span>;
};

const renderDiff = (diff: any) => {
  if (!diff) return <div className="text-xs text-gray-500">Sin cambios registrados</div>;
  return (
    <div className="space-y-2">
      {Object.entries(diff).map(([key, value]: [string, any]) => (
        <div key={key} className="pb-2 border-b border-gray-200 last:border-b-0">
          <div className="text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">{key}</div>
          {renderDiffValue(value)}
        </div>
      ))}
    </div>
  );
};

const renderSnapshot = (snapshot: any) => {
  if (!snapshot) return null;
  const fields = ['name', 'status', 'start_date', 'end_date', 'estimate', 'color', 'notes'];
  return (
    <div className="space-y-1.5">
      {fields.map(field => {
        const val = (snapshot as any)[field];
        if (val === null || val === undefined || val === '') return null;
        return (
          <div key={field} className="flex items-start gap-2 pb-1.5 border-b border-gray-100 last:border-b-0">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide min-w-[80px]">{field}</span>
            <span className="text-xs text-gray-700 font-mono break-words flex-1">{String(val)}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function TaskHistory({ taskId, onRestore }: { taskId: number; onRestore?: () => void }) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<any>(null);

  const fetchVersions = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/versions`);
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchVersionDetail = async (vid: number) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/versions/${vid}`);
      if (!res.ok) return;
      const data = await res.json();
      setDetails(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!taskId) return;
    fetchVersions();
  }, [taskId]);

  useEffect(() => {
    if (selected == null) return;
    fetchVersionDetail(selected);
  }, [selected]);

  const handleRestore = async (vid: number) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/versions/${vid}/restore`, { method: 'POST' });
      if (res.ok) {
        if (onRestore) onRestore();
        fetchVersions();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'create': return 'bg-green-50 border-green-200 text-green-700';
      case 'update': return 'bg-blue-50 border-blue-200 text-blue-700';
      case 'delete': return 'bg-red-50 border-red-200 text-red-700';
      case 'restore': return 'bg-purple-50 border-purple-200 text-purple-700';
      default: return 'bg-gray-50 border-gray-200 text-gray-700';
    }
  };

  const getChangeTypeIcon = (type: string) => {
    switch (type) {
      case 'create': return '✨';
      case 'update': return '✏️';
      case 'delete': return '🗑️';
      case 'restore': return '↩️';
      default: return '📝';
    }
  };

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center gap-2 mb-3">
        <TbClock size={14} className="text-gray-600" />
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-700">Historial de versiones</div>
      </div>
      {versions.length === 0 ? (
        <div className="text-xs text-center text-gray-500 py-4 bg-gray-50 rounded-lg">Sin versiones registradas</div>
      ) : (
        <div className="space-y-2">
          {versions.map((v, idx) => (
            <div
              key={v.id}
              className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                selected === v.id
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
              onClick={() => setSelected(v.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${getChangeTypeColor(v.change_type)}`}>
                      {getChangeTypeIcon(v.change_type)} {v.change_type.toUpperCase()}
                    </span>
                    <span className="text-[11px] text-gray-500">{idx === 0 ? '(más reciente)' : ''}</span>
                  </div>
                  <div className="text-xs text-gray-600 font-mono">
                    {new Date(v.timestamp).toLocaleString('es-AR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                </div>
                <button
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestore(v.id);
                  }}
                  title="Restaurar a esta versión"
                >
                  <TbRotateClockwise2 size={12} /> Restaurar
                </button>
              </div>
            </div>
          ))}
          {selected !== null && details && (
            <div className="mt-4 p-4 rounded-lg border-2 border-blue-200 bg-blue-50">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-900 mb-3">Cambios</div>
                  {details.diff ? (
                    <div className="bg-white p-3 rounded-lg border border-blue-100 max-h-60 overflow-y-auto">
                      {renderDiff(details.diff)}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 bg-white p-3 rounded-lg">Sin cambios detectados</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-900 mb-3">Estado en este momento</div>
                  <div className="bg-white p-3 rounded-lg border border-blue-100 max-h-60 overflow-y-auto">
                    {renderSnapshot(details.snapshot)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
