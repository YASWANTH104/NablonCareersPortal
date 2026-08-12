import { FileText, Download, X } from 'lucide-react';

const PDF_EXT = /\.pdf($|\?)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)($|\?)/i;

/** Generic "view this uploaded file" modal — PDF/image preview inline, download-only fallback otherwise. */
export default function FilePreviewModal({ url, name, onClose }) {
  const isPdf = PDF_EXT.test(name || '') || PDF_EXT.test(url || '');
  const isImage = IMAGE_EXT.test(name || '') || IMAGE_EXT.test(url || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl flex flex-col"
        style={{ height: '80dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-surface-200 flex-shrink-0">
          <h3 className="font-display font-semibold text-gray-900 truncate pr-4">{name || 'Attachment'}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium px-2"
            >
              <Download className="w-4 h-4" /> Download
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isPdf ? (
          <iframe src={url} title={name || 'Attachment'} className="flex-1 w-full rounded-b-2xl" />
        ) : isImage ? (
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            <img src={url} alt={name || 'Attachment'} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <FileText className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-500">
              Preview isn't available for this file type — download it to view.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" /> Download file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
