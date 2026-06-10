import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle, XCircle, PenLine, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { offersApi } from '@/api/offers';

// Simple signature pad using canvas
function SignaturePad({ onCapture, onClear }) {
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

export default function OfferRespondPage() {
  const { token } = useParams();
  const [decision, setDecision] = useState(null); // 'accepted' | 'rejected'
  const [signature, setSignature] = useState(null);
  const [done, setDone] = useState(false);

  // Fetch offer detail via the respond endpoint
  // We re-use the preview — actually we just load offer via the public token.
  // Since we don't have a public GET by token, we'll infer the offer state from the respond response.
  // Show a static loading/form page and submit.

  const respondMut = useMutation({
    mutationFn: ({ decision, signature }) =>
      offersApi.respond(token, { decision, candidate_signature: signature }),
    onSuccess: (res) => {
      setDone(res.data.status);
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Something went wrong');
    },
  });

  function submit() {
    if (!decision) return;
    respondMut.mutate({ decision, candidate_signature: signature });
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-50 to-white flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl border border-surface-200 p-10 max-w-md w-full text-center">
          {done === 'accepted' ? (
            <>
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-9 h-9 text-green-500" />
              </div>
              <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Offer Accepted!</h1>
              <p className="text-gray-500 text-sm">
                Thank you for accepting the offer. The HR team has been notified and will be in touch with the next steps.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
                <XCircle className="w-9 h-9 text-red-400" />
              </div>
              <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Offer Declined</h1>
              <p className="text-gray-500 text-sm">
                Your response has been recorded. Thank you for considering this opportunity with us.
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
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 mb-4">
            <span className="font-display font-bold text-brand-600 text-lg">N</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900">Offer Letter Response</h1>
          <p className="text-gray-500 text-sm mt-1">Nablon AI — Please review and respond to your offer</p>
        </div>

        {/* Decision */}
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-3">Your Decision</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setDecision('accepted')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                decision === 'accepted'
                  ? 'border-green-400 bg-green-50'
                  : 'border-surface-200 hover:border-green-200 hover:bg-green-50/50'
              }`}
            >
              <CheckCircle className={`w-7 h-7 ${decision === 'accepted' ? 'text-green-500' : 'text-gray-300'}`} />
              <span className={`text-sm font-medium ${decision === 'accepted' ? 'text-green-700' : 'text-gray-500'}`}>
                Accept Offer
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
                Decline Offer
              </span>
            </button>
          </div>
        </div>

        {/* Signature (only when accepting) */}
        {decision === 'accepted' && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <PenLine className="w-4 h-4 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Sign below to confirm</p>
              <span className="text-xs text-gray-400">(optional)</span>
            </div>
            <SignaturePad
              onCapture={(dataUrl) => setSignature(dataUrl)}
              onClear={() => setSignature(null)}
            />
          </div>
        )}

        <button
          onClick={submit}
          disabled={!decision || respondMut.isPending}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 ${
            decision === 'accepted'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : decision === 'rejected'
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-brand-500 text-white'
          }`}
        >
          {respondMut.isPending
            ? 'Submitting...'
            : !decision
            ? 'Select your decision above'
            : decision === 'accepted'
            ? 'Confirm Acceptance'
            : 'Confirm Decline'
          }
        </button>

        <p className="text-xs text-gray-300 text-center mt-4">
          This link is unique to you and can only be used once.
        </p>
      </div>
    </div>
  );
}
