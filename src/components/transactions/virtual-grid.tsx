"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

export type VirtualGridHandle = {
  scrollToIndex: (index: number) => void;
};

/** The transactions grid scroll surface. Only the viewport is mounted. */
export const VirtualGrid = forwardRef<
  VirtualGridHandle,
  {
    count: number;
    estimateSize: (index: number) => number;
    overscan?: number;
    width?: number;
    header?: React.ReactNode;
    onVirtualItems?: (items: VirtualItem[]) => void;
    renderItem: (item: VirtualItem) => React.ReactNode;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  }
>(function VirtualGrid({ count, estimateSize, overscan = 8, width, header, onVirtualItems, renderItem, onKeyDown }, ref) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
  });
  const items = virtualizer.getVirtualItems();
  const signature = items.map((item) => item.index).join(",");

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => virtualizer.scrollToIndex(index),
  }));

  useEffect(() => {
    onVirtualItems?.(items);
    // The signature is the row window. `items` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="txn-scroll"
      data-total-size={virtualizer.getTotalSize()}
      className="h-[calc(100vh-320px)] min-h-80 overflow-auto rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Transactions grid"
    >
      <div style={{ width: width ? Math.max(width, 0) : undefined, minWidth: "100%" }}>
      {header}
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => (
          <div key={item.key} data-row={item.index} className="absolute top-0 left-0" style={{ transform: `translateY(${item.start}px)` }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
});
