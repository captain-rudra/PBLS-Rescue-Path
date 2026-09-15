import { forwardRef } from "react";

// Single-video panel shared by video_mcq and hotspot_video. Falls back to
// fallbackText whenever there is no videoUrl, or the video fails to load —
// CLAUDE.md: "the item must still be answerable."
export const MediaFrame = forwardRef(({ media, fallbackText, gate, onInteract, children, posterOverride }, ref) => {
  if (gate.showFallback) {
    return (
      <div className="relative flex min-h-[180px] w-full items-center justify-center rounded-lg border border-dashed border-[#3A4A63] bg-[#1E3050] p-4 text-center">
        <p className="text-[13px] text-slate-200">{fallbackText}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={media.videoUrl}
        poster={posterOverride ?? media.posterUrl ?? undefined}
        controls
        playsInline
        className="max-h-72 w-full"
        onPlay={() => {
          onInteract?.();
          gate.onPlay();
        }}
        onEnded={gate.onEnded}
        onError={gate.onError}
      />
      {children}
      {!gate.satisfied && (
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-center text-[11px] text-white">
          Watch through once to unlock the answer options.
        </div>
      )}
    </div>
  );
});
MediaFrame.displayName = "MediaFrame";
