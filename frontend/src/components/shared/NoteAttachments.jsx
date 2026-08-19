import { useEffect, useState } from 'react';
import { X, FileText, FileSpreadsheet, Eye } from 'lucide-react';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const SHEET_EXT = /\.(xlsx?|csv)$/i;
const PDF_EXT = /\.pdf$/i;

export function isImageFile(nameOrType) {
  return IMAGE_TYPES.has(nameOrType) || /\.(png|jpe?g|gif|webp)$/i.test(nameOrType || '');
}

export function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Small color-coded icon badge so a row of attachments reads at a glance. */
function FileBadge({ name, className = 'w-9 h-9' }) {
  if (SHEET_EXT.test(name || '')) {
    return (
      <div className={`${className} rounded-lg bg-green-50 text-green-500 flex items-center justify-center flex-shrink-0`}>
        <FileSpreadsheet className="w-4 h-4" />
      </div>
    );
  }
  if (PDF_EXT.test(name || '')) {
    return (
      <div className={`${className} rounded-lg bg-red-50 text-red-500 flex items-center justify-center flex-shrink-0`}>
        <FileText className="w-4 h-4" />
      </div>
    );
  }
  return (
    <div className={`${className} rounded-lg bg-surface-100 text-gray-400 flex items-center justify-center flex-shrink-0`}>
      <FileText className="w-4 h-4" />
    </div>
  );
}

/** A file staged in the note composer, not yet uploaded — removable. */
export function PendingAttachmentChip({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const isImage = isImageFile(file.type || file.name);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative flex items-center gap-2.5 bg-white border border-surface-200 rounded-xl pl-2 pr-2 py-2 max-w-[240px] shadow-sm">
      {isImage && previewUrl ? (
        <img src={previewUrl} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <FileBadge name={file.name} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-700 truncate">{file.name}</p>
        <p className="text-[10px] text-gray-400">{formatFileSize(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-500 transition-colors"
        aria-label={`Remove ${file.name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Already-uploaded attachments on a posted note — every tile opens the shared
 * FilePreviewModal (inline PDF/image preview, download fallback otherwise) so
 * viewing a note attachment matches how every other file in this app previews. */
export function NoteAttachmentGallery({ attachments, onPreview }) {
  if (!attachments?.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {attachments.map((a, i) => {
        const isImage = isImageFile(a.content_type || a.name);
        if (isImage) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPreview(a)}
              className="group relative w-20 h-20 rounded-xl overflow-hidden border border-surface-200 shadow-sm hover:shadow-md transition-shadow flex-shrink-0"
              title={`View ${a.name}`}
            >
              <img src={a.url} alt={a.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <Eye className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPreview(a)}
            className="group flex items-center gap-2.5 bg-white hover:bg-surface-50 border border-surface-200 rounded-xl pl-2 pr-3 py-2 max-w-[240px] shadow-sm hover:shadow-md transition-all text-left"
            title={`View ${a.name}`}
          >
            <FileBadge name={a.name} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{a.name}</p>
              <p className="text-[10px] text-gray-400">{formatFileSize(a.size)}</p>
            </div>
            <Eye className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-500 flex-shrink-0 transition-colors" />
          </button>
        );
      })}
    </div>
  );
}
