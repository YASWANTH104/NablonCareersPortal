import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle, XCircle, PenLine, RotateCcw, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { offersApi } from '@/api/offers';

// Canvas-based signature pad, same interaction pattern as OfferRespondPage's SignaturePad
function DrawSignaturePad({ onCapture, onClear }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const source = e.touches ? e.touches[0] : e;
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top,
    };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e) {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111827';
    ctx.lineCap = 'round';
    const { x, y } = getPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
    onCapture(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="border-2 border-dashed border-surface-300 rounded-xl bg-white cursor-crosshair w-full touch-none"
        onMouseDown={start}
        onMouseMove={draw}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={draw}
        onTouchEnd={end}
      />
      <button
        type="button"
        onClick={clear}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1 transition-colors"
      >
        <RotateCcw className="w-3 h-3" /> Clear
      </button>
    </div>
  );
}

function UploadSignaturePad({ preview, onCapture, onClear }) {
  const inputRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onCapture(reader.result);
    reader.readAsDataURL(file);
  }

  return (
    <div>
      {preview ? (
        <div className="border-2 border-dashed border-surface-300 rounded-xl bg-white p-2 flex items-center justify-center h-[120px]">
          <img src={preview} alt="Uploaded signature" className="max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-[120px] border-2 border-dashed border-surface-300 rounded-xl bg-white flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors"
        >
          <Upload className="w-6 h-6" />
          <span className="text-xs font-medium">Click to upload a signature image</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      {preview && (
        <button
          type="button"
          onClick={() => {
            onClear();
            if (inputRef.current) inputRef.current.value = '';
          }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1 transition-colors"
        >
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

export default function DirectorReviewPage() {
  const { token } = useParams();
  const [decision, setDecision] = useState(null); // 'approved' | 'rejected'
  const [signature, setSignature] = useState(null);
  const [signMode, setSignMode] = useState('draw'); // 'draw' | 'upload'
  const [done, setDone] = useState(false);

  const offerQuery = useQuery({
    queryKey: ['director-offer', token],
    queryFn: () => offersApi.getDirectorOffer(token).then((res) => res.data),
    retry: false,
  });

  const decideMut = useMutation({
    mutationFn: ({ decision, signature }) =>
      offersApi.directorDecide(token, { decision, signature }),
    onSuccess: (res) => {
      setDone(res.data.status);
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Something went wrong');
    },
  });

  function submit() {
    if (!decision) return;
    decideMut.mutate({ decision, signature });
  }

  function switchMode(mode) {
    setSignMode(mode);
    setSignature(null);
  }

  if (offerQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-50 to-white flex items-center justify-center p-6">
        <p className="text-gray-400 text-sm">Loading offer…</p>
      </div>
    );
  }

  if (offerQuery.isError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-50 to-white flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl border border-surface-200 p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
            <XCircle className="w-9 h-9 text-red-400" />
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Link Unavailable</h1>
          <p className="text-gray-500 text-sm">
            {offerQuery.error?.response?.data?.detail ?? 'This approval link is invalid or has expired.'}
          </p>
        </div>
      </div>
    );
  }

  const offer = offerQuery.data;

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-50 to-white flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl border border-surface-200 p-10 max-w-md w-full text-center">
          {done === 'sent' ? (
            <>
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-9 h-9 text-green-500" />
              </div>
              <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Offer Approved</h1>
              <p className="text-gray-500 text-sm">
                The offer has been sent to {offer?.candidate_name ?? 'the candidate'} for signature.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
                <XCircle className="w-9 h-9 text-red-400" />
              </div>
              <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Offer Rejected</h1>
              <p className="text-gray-500 text-sm">
                HR has been notified and can revise the offer before resending it.
              </p>
            </>
          )}
          <p className="text-xs text-gray-300 mt-6">You can close this tab.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 to-white flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl border border-surface-200 p-8 max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 mb-4">
            <span className="font-display font-bold text-brand-600 text-lg">N</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900">Offer Approval</h1>
          <p className="text-gray-500 text-sm mt-1">Nablon AI — Please review and approve this offer</p>
        </div>

        <div className="mb-6 bg-surface-50 rounded-xl p-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-500">Candidate</span>
            <span className="font-medium text-gray-900">{offer?.candidate_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Role</span>
            <span className="font-medium text-gray-900">{offer?.designation}</span>
          </div>
          {offer?.department_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Department</span>
              <span className="font-medium text-gray-900">{offer.department_name}</span>
            </div>
          )}
          {offer?.salary_ctc && (
            <div className="flex justify-between">
              <span className="text-gray-500">CTC</span>
              <span className="font-medium text-gray-900">{offer.salary_currency} {offer.salary_ctc.toLocaleString()}</span>
            </div>
          )}
          {offer?.joining_date && (
            <div className="flex justify-between">
              <span className="text-gray-500">Joining Date</span>
              <span className="font-medium text-gray-900">{offer.joining_date}</span>
            </div>
          )}
        </div>

        {offer?.body_html && (
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">Offer Letter</p>
            <div className="border border-surface-200 rounded-xl max-h-80 overflow-y-auto bg-white">
              <div className="p-5 text-sm" dangerouslySetInnerHTML={{ __html: offer.body_html }} />
            </div>
          </div>
        )}

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-3">Your Decision</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setDecision('approved')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                decision === 'approved'
                  ? 'border-green-400 bg-green-50'
                  : 'border-surface-200 hover:border-green-200 hover:bg-green-50/50'
              }`}
            >
              <CheckCircle className={`w-7 h-7 ${decision === 'approved' ? 'text-green-500' : 'text-gray-300'}`} />
              <span className={`text-sm font-medium ${decision === 'approved' ? 'text-green-700' : 'text-gray-500'}`}>
                Approve Offer
              </span>
            </button>
            <button
              onClick={() => setDecision('rejected')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                decision === 'rejected'
                  ? 'border-red-400 bg-red-50'
                  : 'border-surface-200 hover:border-red-200 hover:bg-red-50/50'
              }`}
            >
              <XCircle className={`w-7 h-7 ${decision === 'rejected' ? 'text-red-400' : 'text-gray-300'}`} />
              <span className={`text-sm font-medium ${decision === 'rejected' ? 'text-red-600' : 'text-gray-500'}`}>
                Reject Offer
              </span>
            </button>
          </div>
        </div>

        {decision === 'approved' && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Sign to approve</p>
              </div>
              <div className="flex rounded-lg border border-surface-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => switchMode('draw')}
                  className={`px-3 py-1 font-medium ${signMode === 'draw' ? 'bg-brand-500 text-white' : 'text-gray-500 hover:bg-surface-50'}`}
                >
                  Draw
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('upload')}
                  className={`px-3 py-1 font-medium ${signMode === 'upload' ? 'bg-brand-500 text-white' : 'text-gray-500 hover:bg-surface-50'}`}
                >
                  Upload
                </button>
              </div>
            </div>
            {signMode === 'draw' ? (
              <DrawSignaturePad onCapture={setSignature} onClear={() => setSignature(null)} />
            ) : (
              <UploadSignaturePad preview={signature} onCapture={setSignature} onClear={() => setSignature(null)} />
            )}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!decision || (decision === 'approved' && !signature) || decideMut.isPending}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 ${
            decision === 'approved'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : decision === 'rejected'
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-brand-500 text-white'
          }`}
        >
          {decideMut.isPending
            ? 'Submitting...'
            : !decision
            ? 'Select your decision above'
            : decision === 'approved'
            ? 'Confirm Approval'
            : 'Confirm Rejection'
          }
        </button>

        <p className="text-xs text-gray-300 text-center mt-4">
          This link is unique to this offer and can only be used once.
        </p>
      </div>
    </div>
  );
}
