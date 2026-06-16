import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, CheckCircle2, AlertCircle, FileText, Loader2, Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { documentsApi } from '@/api/documents';

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

function DocRow({ doc, submittedTypes, onUpload, isUploading }) {
  const fileRef = useRef(null);
  const submitted = submittedTypes.includes(doc.type);

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
      submitted ? 'border-green-200 bg-green-50' : 'border-surface-200 bg-white'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
          submitted ? 'bg-green-100' : 'bg-surface-100'
        }`}>
          {submitted
            ? <CheckCircle2 className="w-5 h-5 text-green-600" />
            : <FileText className="w-5 h-5 text-gray-400" />}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${submitted ? 'text-green-800' : 'text-gray-800'}`}>
            {doc.label}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {submitted ? 'Uploaded ✓' : 'PDF, Word, JPG or PNG · max 10 MB'}
          </p>
        </div>
      </div>

      <div className="flex-shrink-0 ml-4">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUpload(doc.type, file);
              e.target.value = '';
            }
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
            submitted
              ? 'border border-green-300 text-green-700 hover:bg-green-100'
              : 'border border-brand-300 text-brand-700 hover:bg-brand-50'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {submitted ? 'Replace' : 'Upload'}
        </button>
      </div>
    </div>
  );
}

export default function DocumentUploadPage() {
  const { token } = useParams();
  const queryClient = useQueryClient();
  const [uploadingType, setUploadingType] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['doc-request', token],
    queryFn: () => documentsApi.getStatus(token).then((r) => r.data),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ type, file }) => documentsApi.upload(token, type, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doc-request', token] });
      toast.success('Document uploaded successfully');
      setUploadingType(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Upload failed. Please try again.');
      setUploadingType(null);
    },
  });

  const handleUpload = (type, file) => {
    setUploadingType(type);
    uploadMutation.mutate({ type, file });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="font-display font-bold text-gray-800 text-xl mb-2">Link invalid or expired</h2>
          <p className="text-sm text-gray-500">
            This document submission link is no longer valid. Please contact our HR team for assistance.
          </p>
        </div>
      </div>
    );
  }

  const allSubmitted = data.required_types.every((d) =>
    data.submitted_types.includes(d.type)
  );

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 py-10 px-4">
        <div className="max-w-xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-brand-100 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Building2 className="w-3.5 h-3.5" />
            Nablon AI Careers
          </div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">
            Document Submission
          </h1>
          <p className="text-brand-200 text-sm">
            Hi <strong className="text-white">{data.candidate_name}</strong>, please upload the
            required documents for your <strong className="text-white">{data.job_title}</strong> offer.
          </p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Completion banner */}
        {allSubmitted && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 mb-6">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">All documents submitted!</p>
              <p className="text-xs text-green-600 mt-0.5">
                Our HR team has been notified and will proceed with your offer letter shortly.
              </p>
            </div>
          </div>
        )}

        {/* Progress */}
        <div className="bg-white rounded-xl border border-surface-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">Progress</p>
            <p className="text-sm text-gray-500">
              <span className="font-semibold text-gray-900">{data.submitted_types.length}</span>
              {' / '}{data.required_types.length} submitted
            </p>
          </div>
          <div className="w-full bg-surface-100 rounded-full h-2">
            <div
              className="bg-brand-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${(data.submitted_types.length / data.required_types.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Document list */}
        <div className="space-y-3">
          {data.required_types.map((doc) => (
            <DocRow
              key={doc.type}
              doc={doc}
              submittedTypes={data.submitted_types}
              onUpload={handleUpload}
              isUploading={uploadingType === doc.type}
            />
          ))}
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          Link expires: {new Date(data.expires_at).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'long', year: 'numeric'
          })}
          {' · '}You can upload each document multiple times to replace a previous submission.
        </p>
      </div>
    </div>
  );
}
