import React from "react";
import { renderCleanFormattedSegments } from "@/lib/formatters/cleanChatText";

interface FormattedChatMessageProps {
  content: string;
  className?: string;
}

export const FormattedChatMessage: React.FC<FormattedChatMessageProps> = ({ content, className = "" }) => {
  const segments = renderCleanFormattedSegments(content);

  return (
    <div className={`space-y-2 text-slate-100 ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === "heading") {
          return (
            <div
              key={idx}
              className="text-sm font-extrabold text-amber-300 border-b border-amber-500/20 pb-1 mt-2.5 first:mt-0 tracking-wide"
            >
              {seg.content}
            </div>
          );
        }

        if (seg.type === "bullet") {
          return (
            <div key={idx} className="flex items-start gap-2 text-xs leading-relaxed pl-1 text-slate-200">
              <span className="text-amber-400 font-bold shrink-0 mt-0.5">•</span>
              <div>
                {seg.lead && (
                  <span className="font-bold text-amber-200 mr-1.5">{seg.lead}:</span>
                )}
                <span className="text-slate-200">{seg.content}</span>
              </div>
            </div>
          );
        }

        if (seg.type === "code_block") {
          return (
            <div
              key={idx}
              className="p-3 my-1.5 rounded-xl bg-slate-950/90 border border-slate-800 font-mono text-[11px] text-sky-300 overflow-x-auto shadow-inner"
            >
              <pre className="whitespace-pre">{seg.content}</pre>
            </div>
          );
        }

        return (
          <p key={idx} className="text-xs leading-relaxed text-slate-200 font-normal">
            {seg.content}
          </p>
        );
      })}
    </div>
  );
};

export default FormattedChatMessage;

