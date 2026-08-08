import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Mail, Loader2 } from 'lucide-react';
import { reportsApi } from '@/api/reports';
import EmailReportModal from '@/components/shared/EmailReportModal';

// Download-as-Excel + email-to-someone controls for a report tab. Mounted once
// in ReportsPage next to the tab/date-range row, reading the active tab key and
// filter params from the parent rather than being duplicated per report.
export default function ReportExportBar({ report, reportLabel, extraParams = {} }) {
  const [showEmailModal, setShowEmailModal] = useState(false);

  const downloadMut = useMutation({
    mutationFn: () => reportsApi.exportReport(report, extraParams),
    onSuccess: (res) => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report}_report.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
    onError: () => toast.error('Could not download the report'),
  });

  const emailMut = useMutation({
    mutationFn: (emails) => reportsApi.emailReport(report, emails, extraParams),
    onSuccess: (res) => {
      const count = res.data?.recipients ?? '';
      toast.success(`Report queued to send to ${count} recipient${count === 1 ? '' : 's'}`);
      setShowEmailModal(false);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to send'),
  });

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => downloadMut.mutate()}
          disabled={downloadMut.isPending}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-surface-300 rounded-lg px-2.5 py-1.5 bg-white hover:bg-surface-50 disabled:opacity-60"
        >
          {downloadMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download Excel
        </button>
        <button
          onClick={() => setShowEmailModal(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-surface-300 rounded-lg px-2.5 py-1.5 bg-white hover:bg-surface-50"
        >
          <Mail className="w-3.5 h-3.5" /> Email to…
        </button>
      </div>

      {showEmailModal && (
        <EmailReportModal
          reportLabel={reportLabel}
          isPending={emailMut.isPending}
          onClose={() => setShowEmailModal(false)}
          onSend={(emails) => emailMut.mutate(emails)}
        />
      )}
    </>
  );
}
