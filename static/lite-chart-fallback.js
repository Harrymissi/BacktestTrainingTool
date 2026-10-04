(function () {
  function createChart(container) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    container.innerHTML = "";
    container.appendChild(canvas);
    const chart = {
      series: [],
      width: 300,
      height: 200,
      range: null,
      crosshair: null,
      scale: null,
      dragging: null,
      panning: null,
      rangeListeners: [],
    };

    canvas.addEventListener("mousedown", function (event) {
      const hit = hitTestDraggableLine(event);
      if (hit) {
        chart.dragging = hit;
        container.dispatchEvent(new CustomEvent("chart-line-drag-start", { detail: hit }));
      } else if (chart.scale) {
        chart.panning = { x: eventPoint(event).x, range: chart.range ? { ...chart.range } : currentFullRange() };
      }
      event.preventDefault();
    });

    window.addEventListener("mouseup", function () {
      chart.dragging = null;
      chart.panning = null;
    });

    canvas.addEventListener("mousemove", function (event) {
      const point = eventPoint(event);
      chart.crosshair = point;
      if (chart.dragging && chart.scale) {
        container.dispatchEvent(
          new CustomEvent("chart-line-drag", {
            detail: { key: chart.dragging.key, price: chart.scale.valueAtY(point.y) },
          })
        );
      } else if (chart.panning && chart.scale) {
        const step = timeStep();
        const barsMoved = Math.round((chart.panning.x - point.x) / Math.max(4, candleSpacing()));
        setRange({
          from: chart.panning.range.from + barsMoved * step,
          to: chart.panning.range.to + barsMoved * step,
        }, true, "pan");
      }
      canvas.style.cursor = chart.dragging || hitTestDraggableLine(event)
        ? "ns-resize"
        : chart.panning
          ? "grabbing"
          : "crosshair";
      draw();
    });

    canvas.addEventListener("mouseleave", function () {
      if (!chart.dragging) chart.crosshair = null;
      draw();
    });

    canvas.addEventListener("wheel", function (event) {
      if (!chart.scale) return;
      event.preventDefault();
      const full = currentFullRange();
      if (!full) return;
      const current = chart.range ? { ...chart.range } : full;
      const point = eventPoint(event);
      const anchorRatio = Math.max(0.05, Math.min(0.95, point.x / Math.max(1, canvas.width)));
      const span = Math.max(timeStep(), current.to - current.from);
      const factor = event.deltaY < 0 ? 0.82 : 1.22;
      const nextSpan = Math.max(timeStep() * 8, Math.min(full.to - full.from || span, span * factor));
      const anchor = current.from + span * anchorRatio;
      setRange({
        from: anchor - nextSpan * anchorRatio,
        to: anchor + nextSpan * (1 - anchorRatio),
      }, true, "wheel");
    }, { passive: false });

    function eventPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(canvas.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(canvas.height, event.clientY - rect.top)),
      };
    }

    function resize() {
      canvas.width = chart.width || container.clientWidth || 300;
      canvas.height = chart.height || container.clientHeight || 200;
      draw();
    }

    function addSeries(kind, options) {
      const series = { kind, options: options || {}, data: [], markers: [] };
      series.setData = function (data) {
        series.data = data || [];
        if (chart.range) chart.range = clampRange(chart.range);
        draw();
      };
      series.setMarkers = function (markers) {
        series.markers = markers || [];
        draw();
      };
      chart.series.push(series);
      return series;
    }

    function visibleData(series) {
      if (!chart.range) return series.data;
      return series.data.filter((item) => item.time >= chart.range.from && item.time <= chart.range.to);
    }

    function currentFullRange() {
      const times = chart.series.flatMap((s) => s.data.map((item) => item.time)).filter((time) => Number.isFinite(time));
      if (!times.length) return null;
      return { from: Math.min(...times), to: Math.max(...times) };
    }

    function timeStep() {
      const times = [...new Set(chart.series.flatMap((s) => s.data.map((item) => item.time)))].sort((a, b) => a - b);
      if (times.length < 2) return 60;
      const diffs = [];
      for (let i = 1; i < times.length; i++) {
        const diff = times[i] - times[i - 1];
        if (diff > 0) diffs.push(diff);
      }
      diffs.sort((a, b) => a - b);
      return diffs[Math.floor(diffs.length / 2)] || 60;
    }

    function candleSpacing() {
      const count = Math.max(1, chart.scale?.times?.length || 1);
      return Math.max(4, (canvas.width - 24) / count);
    }

    function clampRange(range) {
      const full = currentFullRange();
      if (!full) return range;
      const step = timeStep();
      const minSpan = step * 8;
      const fullSpan = Math.max(step, full.to - full.from);
      let span = Math.max(minSpan, Math.min(fullSpan, range.to - range.from));
      let from = range.from;
      let to = from + span;
      if (from < full.from) {
        from = full.from;
        to = from + span;
      }
      if (to > full.to) {
        to = full.to;
        from = to - span;
      }
      return { from, to };
    }

    function setRange(range, notify, source) {
      chart.range = clampRange(range);
      draw();
      if (notify) {
        container.dispatchEvent(new CustomEvent("chart-range-change", { detail: { range: chart.range, source } }));
        for (const listener of chart.rangeListeners) listener(chart.range);
      }
    }

    function buildScale() {
      const all = chart.series.flatMap((s) => visibleData(s));
      if (!all.length) return null;
      const times = [...new Set(all.map((item) => item.time))].sort((a, b) => a - b);
      const values = [];
      for (const s of chart.series) {
        for (const item of visibleData(s)) {
          if (s.kind === "candle") values.push(item.high, item.low);
          else values.push(item.value);
        }
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pad = (max - min || 1) * 0.08;
      const h = canvas.height;
      const w = canvas.width;
      return {
        times,
        y: (value) => h - ((value - min + pad) / (max - min + pad * 2)) * h,
        valueAtY: (yy) => min - pad + ((h - yy) / Math.max(1, h)) * (max - min + pad * 2),
        x: (time) => {
          const idx = times.indexOf(time);
          return times.length <= 1 ? w / 2 : (idx / (times.length - 1)) * (w - 24) + 12;
        },
      };
    }

    function hitTestDraggableLine(event) {
      if (!chart.scale) return null;
      const point = eventPoint(event);
      for (const series of chart.series) {
        if (!series.options.dragKey || !series.data.length) continue;
        const last = series.data[series.data.length - 1];
        const y = chart.scale.y(last.value);
        if (Math.abs(point.y - y) <= 8) {
          return { key: series.options.dragKey, price: last.value };
        }
      }
      return null;
    }

    function drawGrid(w, h) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#edf1f5";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    function drawArrow(x, y, shape, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (shape === "arrowDown") {
        ctx.moveTo(x, y - 11);
        ctx.lineTo(x, y + 8);
        ctx.lineTo(x - 5, y + 2);
        ctx.moveTo(x, y + 8);
        ctx.lineTo(x + 5, y + 2);
      } else {
        ctx.moveTo(x, y + 11);
        ctx.lineTo(x, y - 8);
        ctx.lineTo(x - 5, y - 2);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 5, y - 2);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawPriceLabel(text, y, color) {
      ctx.save();
      ctx.font = "12px Segoe UI, Arial, sans-serif";
      const labelWidth = ctx.measureText(text).width + 12;
      const x = Math.max(0, canvas.width - labelWidth);
      const yy = Math.max(2, Math.min(canvas.height - 20, y - 10));
      ctx.fillStyle = color;
      ctx.fillRect(x, yy, labelWidth, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x + 6, yy + 14);
      ctx.restore();
    }

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      drawGrid(w, h);
      chart.scale = buildScale();
      if (!chart.scale) return;
      const scale = chart.scale;

      for (const s of chart.series) {
        const data = visibleData(s);
        if (s.kind === "candle") {
          const barW = Math.max(3, Math.min(10, w / Math.max(20, data.length) * 0.55));
          for (const item of data) {
            const xx = scale.x(item.time);
            const up = item.close >= item.open;
            ctx.strokeStyle = up ? "#0f9f6e" : "#d44a3a";
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(xx, scale.y(item.high));
            ctx.lineTo(xx, scale.y(item.low));
            ctx.stroke();
            const top = scale.y(Math.max(item.open, item.close));
            const bottom = scale.y(Math.min(item.open, item.close));
            ctx.fillRect(xx - barW / 2, top, barW, Math.max(1, bottom - top));
          }
          for (const marker of s.markers || []) {
            const xx = scale.x(marker.time);
            const anchorPrice = typeof marker.price === "number" ? marker.price : null;
            const yy = anchorPrice == null ? (marker.position === "aboveBar" ? 14 : h - 14) : scale.y(anchorPrice);
            drawArrow(xx, yy, marker.shape, marker.color || "#2867c8");
          }
        } else {
          ctx.strokeStyle = s.options.color || "#2867c8";
          ctx.lineWidth = s.options.lineWidth || 1;
          ctx.setLineDash(s.options.lineStyle === "dashed" ? [6, 5] : []);
          ctx.beginPath();
          data.forEach((item, i) => {
            const xx = scale.x(item.time);
            const yy = scale.y(item.value);
            if (s.kind === "hist") {
              ctx.fillStyle = item.color || ctx.strokeStyle;
              ctx.fillRect(xx - 2, Math.min(scale.y(0), yy), 4, Math.abs(scale.y(0) - yy) || 1);
            } else if (i === 0) {
              ctx.moveTo(xx, yy);
            } else {
              ctx.lineTo(xx, yy);
            }
          });
          if (s.kind !== "hist") ctx.stroke();
          ctx.setLineDash([]);

          if (s.options.dragKey && data.length) {
            const price = data[data.length - 1].value;
            drawPriceLabel(price.toFixed(Math.abs(price) >= 100 ? 2 : 4), scale.y(price), s.options.color || "#2867c8");
          }
        }
      }

      if (chart.crosshair) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chart.crosshair.x, 0);
        ctx.lineTo(chart.crosshair.x, h);
        ctx.moveTo(0, chart.crosshair.y);
        ctx.lineTo(w, chart.crosshair.y);
        ctx.stroke();
        const price = scale.valueAtY(chart.crosshair.y);
        drawPriceLabel(price.toFixed(Math.abs(price) >= 100 ? 2 : 4), chart.crosshair.y, "#1f2933");
        ctx.restore();
      }
    }

    resize();
    return {
      addCandlestickSeries: (options) => addSeries("candle", options),
      addLineSeries: (options) => addSeries("line", options),
      addHistogramSeries: (options) => addSeries("hist", options),
      applyOptions: (options) => {
        chart.width = options.width || chart.width;
        chart.height = options.height || chart.height;
        resize();
      },
      timeScale: () => ({
        subscribeVisibleTimeRangeChange: function (listener) {
          if (typeof listener === "function") chart.rangeListeners.push(listener);
        },
        setVisibleRange: function (range) {
          setRange(range, false, "api");
        },
        scrollToPosition: function () {
          const full = currentFullRange();
          if (!full) return;
          const step = timeStep();
          setRange({ from: full.to - step * 120, to: full.to }, true, "auto");
        },
      }),
    };
  }

  window.LightweightCharts = {
    createChart,
    CrosshairMode: { Normal: 0 },
  };
})();
