/* Robobox Connect - shared UI atoms. */
window.RB = window.RB || {};

RB.ui = (function () {
  'use strict';
  var U = RB.util;
  var toastTimer, modalTimer;

  /* How long the leaving animation in app.css runs. Under reduced motion
   * there is no animation to wait for, so nothing waits. */
  var LEAVE_MS = 180;
  function still() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* Hide an element after its leaving animation, unless something shows it
   * again first - then the leave is simply abandoned, never finished on top
   * of the new content. */
  function leave(el, cls, timer) {
    clearTimeout(timer);
    if (el.hidden) return null;
    if (still()) { el.hidden = true; return null; }
    el.classList.add(cls);
    return setTimeout(function () { el.hidden = true; el.classList.remove(cls); }, LEAVE_MS);
  }

  /* One line-icon set, drawn on a 24px grid with a 2px round stroke, so every
   * icon in the app has the same weight. Shapes after Lucide (ISC licence). */
  var ICONS = {
    day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    tasks: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    schools: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    scorecard: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    business: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    sales: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    market: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
    win: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0Z"/>',
    settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    calx: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M10 14l4 4M14 14l-4 4"/>',
    quiet: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
  };
  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* Pull a bottom sheet down to dismiss it, on a phone. The sheet follows the
   * finger 1:1 from where it was grabbed (only from its top strip, so the
   * content inside still scrolls), resists being pulled up, and on release
   * either carries on down - when it has gone a quarter of the way, or was
   * flicked - or springs back. */
  var GRAB = 64;
  function dragToDismiss(sheet, close) {
    var y0 = 0, dy = 0, last = 0, lastT = 0, v = 0, on = false;
    function phone() { return matchMedia('(max-width: 980px)').matches; }
    sheet.addEventListener('pointerdown', function (e) {
      if (!phone() || e.button > 0) return;
      if (e.clientY - sheet.getBoundingClientRect().top > GRAB) return;
      if (e.target.closest('button, a, input, select, textarea, summary')) return;
      on = true; y0 = last = e.clientY; lastT = e.timeStamp; dy = 0; v = 0;
      sheet.setPointerCapture(e.pointerId);
      sheet.style.transition = 'none';
    });
    sheet.addEventListener('pointermove', function (e) {
      if (!on) return;
      dy = e.clientY - y0;
      var dt = e.timeStamp - lastT;
      if (dt > 0) v = (e.clientY - last) / dt;   // px per ms, latest sample
      last = e.clientY; lastT = e.timeStamp;
      // past the top it gives a little, then less and less
      var y = dy >= 0 ? dy : -(-dy * 40) / (40 + -dy);
      sheet.style.transform = 'translateY(' + y + 'px)';
    });
    function release() {
      if (!on) return;
      on = false;
      var h = sheet.getBoundingClientRect().height;
      if (dy > h * 0.25 || (dy > 24 && v > 0.5)) {
        sheet.style.transition = 'transform 220ms cubic-bezier(.2,0,0,1)';
        sheet.style.transform = 'translateY(100%)';
        setTimeout(function () {
          close();
          sheet.style.transition = 'none';
          sheet.style.transform = '';
          void sheet.offsetHeight;
          sheet.style.transition = '';
        }, 220);
      } else {
        sheet.style.transition = 'transform 380ms cubic-bezier(.22,1,.36,1)';
        sheet.style.transform = '';
        setTimeout(function () { sheet.style.transition = ''; }, 380);
      }
    }
    sheet.addEventListener('pointerup', release);
    sheet.addEventListener('pointercancel', release);
  }

  function toast(msg, action) {
    var el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.classList.remove('is-leaving');
    el.innerHTML = '<span>' + U.esc(msg) + '</span>' +
      (action ? '<button type="button" id="toast-action">' + U.esc(action.label) + '</button>' : '');
    el.hidden = false;
    if (action) {
      el.querySelector('#toast-action').addEventListener('click', function () {
        el.hidden = true; action.run();
      });
    }
    toastTimer = setTimeout(function () { toastTimer = leave(el, 'is-leaving', toastTimer); },
                            action ? 7000 : 2800);
  }

  function modal(title, body, opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    // Opening while the last one is still closing: cancel the close.
    clearTimeout(modalTimer);
    root.classList.remove('is-closing');
    root.querySelector('.modal').classList.toggle('wide', !!opts.wide);
    document.getElementById('modal-title').textContent = title;
    var host = document.getElementById('modal-body');
    host.innerHTML = '';
    if (typeof body === 'string') host.innerHTML = body; else host.appendChild(body);
    root.hidden = false;
    host.scrollTop = 0;
    if (opts.onMount) opts.onMount(host);
    return host;
  }
  function closeModal(now) {
    var root = document.getElementById('modal-root');
    if (now === true) { clearTimeout(modalTimer); root.hidden = true; root.classList.remove('is-closing'); return; }
    modalTimer = leave(root, 'is-closing', modalTimer);
  }

  /* ONE headline tile, used by every screen. The old `.stat` names are kept as
   * the call signature so nothing else had to change:
   *   cls 'stat-hero'  -> the dark anchor. One per strip, the primary number.
   *   cls 'stat-red'   -> at risk. Colour means something; it is not decoration.
   *   cls 'stat-brand' -> nothing. Yellow is reserved for "you are here" and
   *                       "this is the goal", so a tile never claims it. */
  var TONE = { 'stat-hero': ' kpi-dark', 'stat-red': ' is-risk' };

  function stat(o) {
    var tag = o.onClick ? 'button' : 'div';
    return '<' + tag + ' class="kpi' + (TONE[o.cls] || '') + (o.small ? ' kpi-sm' : '') + '"' +
      (o.onClick ? ' type="button" data-stat="' + U.esc(o.onClick) + '"' : '') +
      (o.title ? ' title="' + U.esc(o.title) + '"' : '') + '>' +
      '<span class="kpi-label">' + U.esc(o.label) + '</span>' +
      '<span class="kpi-value">' + U.esc(o.value) + '</span>' +
      (o.foot ? '<span class="kpi-foot' + (o.footBad ? ' is-bad' : '') + '">' + U.esc(o.foot) + '</span>' : '') +
      '</' + tag + '>';
  }
  function stats(items) { return '<div class="kpis">' + items.join('') + '</div>'; }

  function head(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + U.esc(title) + '</h1>' +
      (sub ? '<p>' + U.esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="spacer">' + actions + '</div>' : '') + '</div>';
  }

  function card(title, sub, body) {
    return '<div class="card"><div class="card-head"><h3>' + U.esc(title) + '</h3>' +
      (sub ? '<span class="card-sub">' + U.esc(sub) + '</span>' : '') + '</div>' + body + '</div>';
  }

  function stageTag(v) {
    var cls = v.stage === 'Won' ? 'tag-brand' : v.stage === 'Lost' ? 'tag-red' : 'tag-dark';
    return '<span class="tag ' + cls + '">' + U.esc(v.stage) + '</span>';
  }

  function interestTag(level) {
    if (!level) return '';
    return '<span class="tag tag-' + level.toLowerCase() + '">' + U.esc(level) + '</span>';
  }

  function select(name, options, value, opts) {
    opts = opts || {};
    return '<select class="input" name="' + U.esc(name) + '"' + (opts.required ? ' required' : '') + '>' +
      (opts.placeholder ? '<option value="">' + U.esc(opts.placeholder) + '</option>' : '') +
      options.map(function (o) {
        var v = typeof o === 'string' ? o : o.value, l = typeof o === 'string' ? o : o.label;
        return '<option value="' + U.esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' +
          U.esc(l) + '</option>';
      }).join('') + '</select>';
  }

  function field(label, control, hint) {
    return '<label class="field"><span class="field-label">' + U.esc(label) + '</span>' + control +
      (hint ? '<span class="field-hint">' + U.esc(hint) + '</span>' : '') + '</label>';
  }

  /* Big tap targets, one choice per row group. Used everywhere a dropdown
   * would be slower than a thumb. */
  function choice(name, options, value, opts) {
    opts = opts || {};
    return '<div class="choice' + (opts.tight ? ' tight' : '') + '" data-choice="' + U.esc(name) + '">' +
      options.map(function (o) {
        var v = typeof o === 'string' ? o : o.value;
        var l = typeof o === 'string' ? o : o.label;
        var sub = typeof o === 'object' ? o.sub : null;
        return '<button type="button" data-value="' + U.esc(v) + '" aria-pressed="' + (v === value) + '">' +
          U.esc(l) + (sub ? '<small>' + U.esc(sub) + '</small>' : '') + '</button>';
      }).join('') +
      '</div><input type="hidden" name="' + U.esc(name) + '" value="' + U.esc(value || '') + '">';
  }

  /* Wire every choice group inside a container. */
  function bindChoices(host, onPick) {
    host.querySelectorAll('[data-choice]').forEach(function (group) {
      var name = group.getAttribute('data-choice');
      var hidden = group.parentNode.querySelector('input[name="' + name + '"]');
      group.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-value]');
        if (!b) return;
        group.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        if (hidden) hidden.value = b.getAttribute('data-value');
        if (onPick) onPick(name, b.getAttribute('data-value'));
      });
    });
  }

  /* Every date field in the app opens the native calendar on click instead of
   * asking anyone to type into dd/mm/yyyy boxes. */
  function bindDatePickers(host) {
    host.querySelectorAll('input[type=date]').forEach(function (i) {
      if (i.dataset.picker) return;
      i.dataset.picker = '1';
      i.addEventListener('click', function () { try { i.showPicker(); } catch (e) {} });
    });
  }

  function values(form) {
    var out = {};
    new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }

  /* ------------------------------------------------------------- calendar */
  /* One month grid. The rep's calendar and the CEO's day picker are the same
   * thing - a month, a count per day, one selected day - so there is one of
   * them. `get(iso)` returns { n, title } for a day; a day with nothing on it
   * is left plain, which is how you spot the days that have something. */
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function monthGrid(o) {
    var y = +o.month.slice(0, 4), m = +o.month.slice(5, 7);
    var lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;      // Monday-first
    var weeks = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7);
    var todayISO = U.iso(U.today());

    var cells = '';
    for (var i = 0; i < weeks * 7; i++) {
      var d = new Date(y, m - 1, 1 - lead + i);
      var iso = U.iso(d);
      var info = (o.get && o.get(iso)) || {};
      cells += '<button type="button" class="cal-cell' +
        (d.getMonth() !== m - 1 ? ' is-out' : '') +
        (iso === todayISO ? ' is-today' : '') +
        (info.cls ? ' ' + info.cls : '') + '"' +
        ' data-day="' + iso + '"' +
        (iso === o.selected ? ' aria-pressed="true"' : '') +
        (o.max && iso > o.max ? ' disabled' : '') +
        (info.title ? ' title="' + U.esc(info.title) + '"' : '') + '>' +
        '<span class="cal-num">' + d.getDate() + '</span>' +
        (info.n ? '<span class="cal-dot">' + U.esc(U.count(info.n)) + '</span>' : '') +
        '</button>';
    }

    return '<div class="cal">' +
      '<div class="cal-head">' +
        '<button type="button" class="icon-btn" data-mon="-1" aria-label="Previous month">‹</button>' +
        '<strong>' + U.esc(U.monthLabel(o.month)) + '</strong>' +
        '<button type="button" class="icon-btn" data-mon="1" aria-label="Next month">›</button>' +
        '<span class="spacer"></span>' +
        (o.legend ? '<span class="small muted">' + U.esc(o.legend) + '</span>' : '') +
        '<button type="button" class="btn btn-sm" data-day="' + todayISO + '">Today</button>' +
      '</div>' +
      '<div class="cal-week">' + WEEKDAYS.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-grid">' + cells + '</div></div>';
  }

  function bindMonthGrid(host, onPick, onMonth) {
    host.querySelectorAll('.cal [data-day]').forEach(function (b) {
      b.addEventListener('click', function () { onPick(b.getAttribute('data-day')); });
    });
    host.querySelectorAll('.cal [data-mon]').forEach(function (b) {
      b.addEventListener('click', function () { onMonth(+b.getAttribute('data-mon')); });
    });
  }

  /* Sortable, paged table. */
  function table(container, cfg) {
    var st = { key: cfg.sortKey || null, dir: cfg.sortDir || 'desc', page: 0, size: cfg.pageSize || 20 };
    function render() {
      var rows = cfg.rows.slice();
      if (st.key) {
        var col = cfg.columns.filter(function (c) { return c.key === st.key; })[0];
        if (col) rows = U.sortBy(rows, col.sortValue || col.get, st.dir);
      }
      var pages = Math.max(1, Math.ceil(rows.length / st.size));
      if (st.page >= pages) st.page = pages - 1;
      var slice = rows.slice(st.page * st.size, (st.page + 1) * st.size);

      container.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr>' +
        cfg.columns.map(function (c) {
          var arrow = st.key === c.key ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '';
          return '<th class="' + (c.num ? 'num ' : '') + (c.sortable === false ? '' : 'sortable') + '"' +
            (c.sortable === false ? '' : ' data-sort="' + U.esc(c.key) + '"') + '>' + U.esc(c.label) + arrow + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        (slice.length ? slice.map(function (r, i) {
          return '<tr' + (cfg.onRowClick ? ' class="row-link" data-row="' + U.esc(cfg.rowId(r)) + '"' : '') + '>' +
            cfg.columns.map(function (c) {
              return '<td class="' + (c.num ? 'num' : '') + '">' + (c.render ? c.render(r, i) : U.esc(c.get(r))) + '</td>';
            }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + cfg.columns.length + '"><div class="table-empty">' +
          U.esc(cfg.empty || 'Nothing here yet.') + '</div></td></tr>') +
        '</tbody></table>' +
        (rows.length > st.size
          ? '<div class="table-foot"><span>' + (st.page * st.size + 1) + '–' +
            Math.min(rows.length, (st.page + 1) * st.size) + ' of ' + U.count(rows.length) + '</span>' +
            '<span class="spacer"></span>' +
            '<button class="btn btn-sm" data-page="prev"' + (st.page === 0 ? ' disabled' : '') + '>Previous</button>' +
            '<button class="btn btn-sm" data-page="next"' + (st.page >= pages - 1 ? ' disabled' : '') + '>Next</button></div>'
          : '<div class="table-foot"><span>' + U.count(rows.length) + ' row' + (rows.length === 1 ? '' : 's') + '</span></div>') +
        '</div>';

      container.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var k = th.getAttribute('data-sort');
          if (st.key === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.key = k; st.dir = 'desc'; }
          render();
        });
      });
      container.querySelectorAll('[data-page]').forEach(function (b) {
        b.addEventListener('click', function () {
          st.page += b.getAttribute('data-page') === 'next' ? 1 : -1; render();
        });
      });
      if (cfg.onRowClick) {
        container.querySelectorAll('tr[data-row]').forEach(function (tr) {
          tr.addEventListener('click', function (e) {
            if (e.target.closest('button,a,select,input')) return;
            cfg.onRowClick(tr.getAttribute('data-row'));
          });
        });
      }
    }
    render();
    return { render: render };
  }

  /* Standard opportunity columns, reused by every list in the app. */
  function oppColumns(opts) {
    opts = opts || {};
    var cols = [
      { key: 'school', label: 'School', get: function (v) { return v.school ? v.school.name : ''; },
        render: function (v) {
          return '<span class="strong">' + U.esc(v.school ? v.school.name : '—') + '</span>' +
            '<div class="small muted">' + U.esc([v.school && v.school.location, v.opp.offering].filter(Boolean).join(' · ')) + '</div>';
        } },
      { key: 'stage', label: 'Stage', get: function (v) { return v.stageRank; }, render: stageTag },
      { key: 'value', label: 'Value', num: true, get: function (v) { return v.current || 0; },
        render: function (v) {
          return U.money(v.current) + (v.initialPotential && v.current !== v.initialPotential
            ? '<div class="small muted">from ' + U.money(v.initialPotential) + '</div>' : '');
        } },
      { key: 'last', label: 'Last connect', num: true,
        get: function (v) { return v.lastAt ? -U.daysSince(v.lastAt) : -99999; },
        render: function (v) {
          return v.lastAt
            ? '<span class="nowrap">' + U.esc(U.fmtDate(v.lastAt)) + '</span><div class="small muted">' +
              U.esc(U.relative(v.lastAt)) + '</div>'
            : '<span class="muted">never</span>';
        } },
      { key: 'next', label: 'Next Step', get: function (v) { return v.nextAction || ''; },
        render: function (v) {
          if (!v.nextAction) return '<span class="tag tag-red">None set</span>';
          return U.esc(v.nextAction) + (v.nextActionAt
            ? '<div class="small ' + (v.overdue ? '' : 'muted') + '">' +
              (v.overdue ? '<span class="tag tag-red">overdue ' + U.esc(U.fmtDate(v.nextActionAt.slice(0, 10))) + '</span>'
                         : U.esc(U.fmtDate(v.nextActionAt.slice(0, 10)))) + '</div>' : '');
        } },
      { key: 'owner', label: 'Owner', get: function (v) { return v.owner || 'Unassigned'; },
        render: function (v) { return v.owner ? U.esc(v.owner) : '<span class="tag tag-red">Unassigned</span>'; } }
    ];
    if (opts.hide) cols = cols.filter(function (c) { return opts.hide.indexOf(c.key) === -1; });
    return cols;
  }

  /* On a phone a table becomes a stack of cards, each value captioned with its
   * column name. The captions are read off the header row, so every table -
   * the shared one and the hand-built ones - gets them without knowing. */
  function labelTables() {
    document.querySelectorAll('table.data:not([data-labelled])').forEach(function (t) {
      var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) {
        return th.textContent.replace(/[↑↓]/g, '').trim();
      });
      t.querySelectorAll('tbody tr, tfoot tr').forEach(function (tr) {
        var col = 0;
        tr.querySelectorAll('td').forEach(function (td) {
          if (td.colSpan === 1 && heads[col]) td.setAttribute('data-label', heads[col]);
          col += td.colSpan;
        });
      });
      t.setAttribute('data-labelled', '1');
    });
  }
  new MutationObserver(labelTables).observe(document.body, { childList: true, subtree: true });

  /* A drill-down list of opportunities, from any number anywhere. */
  function drill(title, vs) {
    var holder = document.createElement('div');
    holder.innerHTML = '<div id="drill-table"></div>';
    modal(title + ' · ' + vs.length, holder, {
      wide: true,
      onMount: function (h) {
        table(h.querySelector('#drill-table'), {
          rows: vs, rowId: function (v) { return v.opp.id; }, sortKey: 'value', pageSize: 15,
          columns: oppColumns(), onRowClick: function (id) { RB.views.school(RB.store.opportunityById(id).schoolId); },
          empty: 'Nothing here.'
        });
      }
    });
  }

  return {
    toast: toast, modal: modal, closeModal: closeModal, stat: stat, stats: stats,
    head: head, card: card, stageTag: stageTag, interestTag: interestTag,
    select: select, field: field, choice: choice, bindChoices: bindChoices,
    values: values, bindDatePickers: bindDatePickers, table: table, oppColumns: oppColumns, drill: drill,
    monthGrid: monthGrid, bindMonthGrid: bindMonthGrid, icon: icon, dragToDismiss: dragToDismiss
  };
})();
