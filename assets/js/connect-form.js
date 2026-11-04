window.RB = window.RB || {};

RB.connectForm = (function () {
  'use strict';

  var U = RB.util, M = RB.model, UI = RB.ui, V = RB.model.V;
  var d = null;   // draft carried across the steps of one connect

  function open(preset) {
    d = Object.assign({ kind: null, schoolId: null, opportunityId: null, contactId: null },
      preset || {});
    if (d.opportunityId) { d.kind = 'Existing'; return stepConnect(); }
    if (d.schoolId) { d.kind = 'Existing'; return stepPickOpportunity(); }
    stepKind();
  }

  /* The school this draft is about, whichever path got us here: typed on a
   * new lead, or picked from the database on an existing one. */
  function draftSchool() {
    return d.school || RB.store.schoolById(d.schoolId) || {};
  }

  function shell(title, body, onMount) {
    return UI.modal(title, body, {
      onMount: function (host) {
        UI.bindDatePickers(host);
        if (onMount) onMount(host);
      }
    });
  }

  function owners() {
    return RB.store.users().filter(function (u) { return u.ownerKey; })
      .map(function (u) { return { value: u.ownerKey, label: u.name }; });
  }

  /* ------------------------------------------------------------- entry */
  function stepKind() {
    shell('Log a Connect',
      '<div class="cx-step"><h3>Which is it?</h3>' +
      UI.choice('kind', [
        { value: 'New', label: 'New School Connect', sub: 'Create and convert a new school lead' },
        { value: 'Existing', label: 'Existing School Connect', sub: 'Grow an opportunity at a school we know' }
      ], d.kind) + '</div>',
      function (host) {
        UI.bindChoices(host, function (_, v) {
          d.kind = v;
          v === 'New' ? stepNewLead() : stepSearchSchool();
        });
      });
  }

  /* ============================================ NEW SCHOOL CONNECT ==== */
  /* 1. Create new school lead — the name is typed, not searched. */
  function stepNewLead() {
    shell('New school lead',
      '<form id="f">' +
      '<div class="field-row">' +
      UI.field('School name', '<input class="input" name="name" required autofocus autocomplete="off">') +
      UI.field('Location', '<input class="input" name="location" required>') +
      '</div>' +
      '<div class="field-row">' +
      UI.field('Sales region', UI.select('region', V.region, null, { placeholder: 'Select', required: true })) +
      UI.field('Board', UI.select('board', V.board, null, { placeholder: 'Select', required: true })) +
      UI.field('Student count', '<input class="input" type="number" name="students" min="0" step="1" inputmode="numeric">') +
      '</div>' +
      '<div class="field-row">' +
      UI.field('Lead source', UI.select('leadSource', V.leadSource, null, { placeholder: 'Select', required: true })) +
      UI.field('Referral person', '<input class="input" name="referredBy" placeholder="Only if referred">') +
      '</div>' +
      '<div id="dupe"></div>' +
      '<div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button></div>' +
      '</form>',
      function (host) {
        var f = host.querySelector('#f'), dupe = host.querySelector('#dupe');
        // A school exists once — warn before a second record is created.
        f.querySelector('[name=name]').addEventListener('input', U.debounce(function () {
          var t = this.value.trim();
          var hit = t.length > 2 && RB.store.schools().filter(function (s) {
            return s.name.toLowerCase().indexOf(t.toLowerCase()) !== -1;
          })[0];
          dupe.innerHTML = hit
            ? '<div class="prev-connect"><div class="pc-label">Already on file</div>' +
            U.esc(hit.name) + ' — ' + U.esc(hit.location || '') +
            '. <button type="button" class="btn btn-sm" data-use="' + U.esc(hit.id) + '">Use that school</button></div>'
            : '';
          var b = dupe.querySelector('[data-use]');
          if (b) b.addEventListener('click', function () {
            d.schoolId = b.getAttribute('data-use'); d.kind = 'Existing'; stepPickOpportunity();
          });
        }, 200));

        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var v = UI.values(this);
          d.school = {
            name: v.name, location: v.location, region: v.region, board: v.board,
            students: v.students ? Number(v.students) : null,
            leadSource: v.leadSource || null,
            referredBy: v.referredBy || null,
            ownerKey: RB.auth.user().ownerKey
          };
          stepStemLab();
        });
      });
  }

  /* 2. Does a STEM lab already exist? */
  function stepStemLab() {
    shell(d.school.name + ' · existing lab',
      '<div class="cx-step"><h3>Does a STEM lab already exist?</h3>' +
      UI.choice('stemLab', [
        { value: 'Yes', label: 'Yes', sub: 'Capture who runs it and what they spend' },
        { value: 'No', label: 'No', sub: 'Straight to the opportunity' }
      ], null) + '</div>',
      function (host) {
        UI.bindChoices(host, function (_, v) {
          d.school.stemLab = v;
          v === 'Yes' ? stepLabProfile() : stepOpportunity();
        });
      });
  }

  /* 2a. Existing lab profile. */
  function stepLabProfile() {
    shell(d.school.name + ' · existing lab profile',
      '<form id="f">' +
      UI.field('Competition name', UI.select('competitor', V.competitor2, null, { placeholder: 'Select', required: true })) +
      '<div class="field-row">' +
      UI.field('Type of lab', UI.select('labType', V.labType, null, { placeholder: 'Select' })) +
      UI.field('Spend on existing lab (₹)', '<input class="input" type="number" name="labSpend" min="0" step="any" inputmode="decimal">') +
      '</div>' +
      '<div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button></div>' +
      '</form>',
      function (host) {
        host.querySelector('#f').addEventListener('submit', function (e) {
          e.preventDefault();
          var v = UI.values(this);
          d.school.competitor = v.competitor;
          d.school.existingLab = 'Competitor';
          d.school.labType = v.labType || null;
          d.school.labSpend = v.labSpend ? Number(v.labSpend) : null;
          stepOpportunity();
        });
      });
  }

  function submitAllConnects() {
    if (d.school && !d.schoolId) d.schoolId = RB.store.addSchool(d.school).id;

    var createdOppIds = [];
    var primaryForm = null;

    // 1. Create or update all selected opportunities from the queue
    d.opportunityQueue.forEach(function (oppItem, index) {
      var f = oppItem.formData || {};
      if (index === 0) primaryForm = f; // Capture primary form data for the shared connect log

      var oppId = RB.store.addOpportunity(Object.assign({
        schoolId: d.schoolId,
        ownerKey: RB.auth.user().ownerKey,
        offering: oppItem.offering,
        variant: oppItem.variant || null,
        initialPotential: oppItem.initialPotential,
        expectedClosure: f.expectedClosure || null,
        probability: f.probability ? Number(f.probability) : null,
        stage: f.stage || null,
        salesYear: f.salesYear || null
      }, oppItem)).id;

      createdOppIds.push(oppId);
    });

    // 2. Log EXACTLY ONE connect record for this school visit, linking to the primary opportunity
    if (primaryForm && createdOppIds.length > 0) {
      var f = primaryForm;
      var contactId = f.contactId && f.contactId !== '__new' ? f.contactId : null;
      if (!contactId && f.contactName) {
        contactId = RB.store.addContact({
          schoolId: d.schoolId, name: f.contactName,
          role: f.contactRole || null, phone: f.contactPhone || null
        }).id;
      }

      var stopped = M.CLOSED[f.stage] && f.stage !== 'Won';
      var closed = M.CLOSED[f.stage];

      RB.store.logConnect({
        schoolId: d.schoolId,
        opportunityId: createdOppIds[0],
        by: RB.auth.user().id,
        kind: d.kind === 'New' ? 'New' : 'Reconnect',
        mode: f.mode,
        contactId: contactId,
        response: f.response,
        blocker: f.blocker || 'None',
        blockerDetail: f.blockerDetail || null,
        stage: f.stage,
        expectedValue: f.expectedValue ? Number(f.expectedValue) : null,
        probability: f.probability ? Number(f.probability) : null,
        expectedClosure: f.expectedClosure || null,
        salesYear: f.salesYear || null,
        remarks: stopped ? (f.lossReasonNote || null) : (f.remarks || null),
        nextAction: stopped ? 'No Further Action' : f.nextAction,
        nextActionOwner: stopped ? null : f.nextActionOwner,
        nextActionAt: stopped ? null : f.nextDate + 'T11:00:00',
        at: f.date + 'T' + new Date().toTimeString().slice(0, 8),
        close: closed ? { status: closed, reason: f.lossReason || null, value: f.expectedValue ? Number(f.expectedValue) : null } : null
      });
    }

    UI.closeModal();
    UI.toast('Saved 1 school connect across ' + d.opportunityQueue.length + ' opportunities.');
    RB.app.refresh();
  }

  /* ================================================= sequential connect loop === */
  function stepConnectLoop() {
    if (!d.opportunityQueue || d.opportunityQueueIndex >= d.opportunityQueue.length) {
      submitAllConnects();
      return;
    }

    var currentOppDraft = d.opportunityQueue[d.opportunityQueueIndex];
    d.opportunity = currentOppDraft;

    var isNew = d.kind === 'New';
    var schoolName = draftSchool().name;
    var contacts = d.schoolId ? RB.store.contactsFor(d.schoolId) : [];
    var today = U.iso(U.today());
    var currentItemNum = d.opportunityQueueIndex + 1;
    var totalItems = d.opportunityQueue.length;

    var savedData = currentOppDraft.formData || {};

    shell(schoolName + ' · connect (' + currentItemNum + ' of ' + totalItems + ': ' + currentOppDraft.offering + (currentOppDraft.variant ? ' - ' + currentOppDraft.variant : '') + ')',
      '<form id="f">' +
      '<div class="modal-actions" style="margin-bottom:12px;">' +
      '<button type="button" class="btn btn-sm" id="btn-back-step">← Back</button>' +
      '</div>' +

      '<div class="cx-step"><h3>Type of connect</h3>' +
      UI.choice('mode', V.connectMode, savedData.mode || null, { tight: true }) + '</div>' +

      '<div class="field-row">' +
      UI.field('Date of connect', '<input class="input" type="date" name="date" value="' + (savedData.date || today) + '" max="' + today + '" required>') +
      UI.field('Contact person',
        contacts.length
          ? UI.select('contactId', contacts.map(function (c) { return { value: c.id, label: c.name + (c.role ? ' — ' + c.role : '') }; })
            .concat([{ value: '__new', label: '+ New contact' }]), savedData.contactId || contacts[0].id)
          : '<input class="input" name="contactName" value="' + U.esc(savedData.contactName || '') + '" placeholder="Name">') +
      '</div>' +
      '<div id="new-contact" hidden></div>' +

      '<div class="cx-step"><h3>Response / outcome</h3>' +
      UI.choice('response', V.response, savedData.response || null, { tight: true }) + '</div>' +

      '<div id="blocker-step" hidden></div>' +

      '<div class="cx-step" id="next-step"><h3>Next action</h3>' +
      '<div class="field-row">' +
      UI.field('Action', UI.select('nextAction', V.nextAction, savedData.nextAction || null, { placeholder: 'Select action', required: true })) +
      UI.field('Owner', UI.select('nextActionOwner', owners(), savedData.nextActionOwner || RB.auth.user().ownerKey, { required: true })) +
      UI.field('Follow-up date', '<input class="input" type="date" name="nextDate" value="' + (savedData.nextDate || U.addDays(today, 7)) + '" required>') +
      '</div></div>' +

      '<div class="cx-step"><h3>Pipeline stage</h3>' +
      UI.choice('stage', V.stage, savedData.stage || null, { tight: true }) + '</div>' +

      '<div class="cx-step" id="commercial"><h3>Expected deal size &amp; closure</h3>' +
      '<div class="field-row">' +
      UI.field('Expected deal size (₹)', '<input class="input" type="number" name="expectedValue" min="0" step="any" inputmode="decimal" value="' + (savedData.expectedValue != null ? savedData.expectedValue : currentOppDraft.initialPotential) + '">') +
      UI.field('Expected closure date', '<input class="input" type="date" name="expectedClosure" value="' + U.esc(savedData.expectedClosure || '') + '">') +
      UI.field('Probability (%)', UI.select('probability', V.probability, savedData.probability || null, { placeholder: 'Select' })) +
      UI.field('Sales year', UI.select('salesYear', V.salesYear, savedData.salesYear || M.currentSalesYear(), { required: true })) +
      '</div>' +
      UI.field('Remarks', '<input class="input" name="remarks" value="' + U.esc(savedData.remarks || '') + '" placeholder="Optional">') +
      '</div>' +

      '<div id="close-wrap"></div>' +

      '<div class="modal-actions">' +
      '<button type="submit" class="btn btn-primary btn-lg btn-block">' +
      (currentItemNum < totalItems ? 'Save & Continue to Next Opportunity' : (isNew ? 'Save lead & opportunities' : 'Save all opportunities')) + '</button></div>' +
      '</form>',
      function (host) {
        var form = host.querySelector('#f');

        function saveCurrentState() {
          currentOppDraft.formData = UI.values(form);
        }

        host.querySelector('#btn-back-step').addEventListener('click', function () {
          saveCurrentState();
          if (d.opportunityQueueIndex > 0) {
            d.opportunityQueueIndex--;
            stepConnectLoop();
          } else {
            stepOpportunity();
          }
        });

        var blockerStep = host.querySelector('#blocker-step');
        function showBlockers(rejected) {
          blockerStep.hidden = !rejected;
          blockerStep.innerHTML = rejected
            ? '<div class="cx-step"><h3>Why was it rejected?</h3>' +
            UI.choice('blocker', V.blocker.filter(function (b) { return b !== 'None'; }), savedData.blocker || null, { tight: true }) +
            '<div id="blocker-detail" ' + (savedData.blockerDetail ? '' : 'hidden') + ' style="margin-top:12px">' +
            (savedData.blockerDetail ? UI.field('Blocker detail (optional)', '<input class="input" name="blockerDetail" value="' + U.esc(savedData.blockerDetail) + '">') : '') +
            '</div></div>'
            : '';
          if (rejected) UI.bindChoices(blockerStep, onPick);
        }

        var closeWrap = host.querySelector('#close-wrap');
        var stageGroup = host.querySelector('[data-choice="stage"]');
        var stageHidden = host.querySelector('input[name="stage"]');

        function onPick(name, val) {
          if (name === 'response' || name === 'mode') {
            var f = UI.values(form);
            if (!d.stageTouched) setStage(M.suggestStage(f.response, f.mode));
            if (name === 'response') showBlockers(val === 'Rejected');
          }
          if (name === 'stage') {
            d.stageTouched = true;
            showClose(M.CLOSED[val] && val !== 'Won' ? val : null);
          }
        }
        UI.bindChoices(host, onPick);
        showBlockers(savedData.response === 'Rejected');

        function showClose(stage) {
          var closing = !!stage;
          [host.querySelector('#next-step'), host.querySelector('#commercial')].forEach(function (el) {
            el.hidden = closing;
            el.querySelectorAll('[required]').forEach(function (i) {
              if (closing) { i.dataset.wasRequired = '1'; i.required = false; }
            });
            if (!closing) {
              el.querySelectorAll('[data-was-required]').forEach(function (i) { i.required = true; });
            }
          });
          closeWrap.innerHTML = closing ? closeFields(stage, savedData.lossReason) : '';
        }

        function closeFields(stage, selectedReason) {
          return '<div class="cx-step"><h3>' +
            (stage === 'On Hold' ? 'Why is it on hold?' : 'Why was it lost?') + '</h3>' +
            UI.field('Reason', UI.select('lossReason', V.lossReason, selectedReason || null, { placeholder: 'Select a reason', required: true })) +
            '<div id="reason-note" ' + (selectedReason === 'Other' ? '' : 'hidden') + '></div></div>';
        }

        function setStage(stage) {
          stageGroup.querySelectorAll('button').forEach(function (b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-value') === stage);
          });
          stageHidden.value = stage;
          showClose(M.CLOSED[stage] && stage !== 'Won' ? stage : null);
        }

        if (savedData.stage) {
          setStage(savedData.stage);
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var f = UI.values(this);
          if (!f.mode) return UI.toast('Pick the type of connect.');
          if (!f.response) return UI.toast('Record the response.');
          if (!f.stage) return UI.toast('Set the pipeline stage.');

          currentOppDraft.formData = f;

          d.opportunityQueueIndex++;
          stepConnectLoop();
        });
      });
  }

  /* ==================================== opportunity multi-select step === */
  function stepOpportunity() {
    var school = draftSchool();

    shell(school.name + ' · opportunities',
      '<form id="f">' +
      '<div class="cx-step"><h3>Opportunity types (Select multiple)</h3>' +
      '<div class="choice tight" data-choice-multi="offering">' +
      V.offering.map(function (o) {
        var label = V.offeringLabel[o] || o;
        var sub = V.offeringDetail[o];
        return '<button type="button" class="btn-multi" data-value="' + U.esc(o) + '" aria-pressed="false">' +
          U.esc(label) + (sub ? '<small>' + U.esc(sub) + '</small>' : '') + '</button>';
      }).join('') +
      '</div></div>' +

      '<div id="bagless-container" hidden style="margin-top:16px;">' +
      '<div class="cx-step"><h3>Bagless skills (Select multiple)</h3>' +
      '<div class="choice tight" data-choice-multi="bagless">' +
      (M.activities() || []).map(function (act) {
        return '<button type="button" class="btn-multi" data-value="' + U.esc(act) + '" aria-pressed="false">' + U.esc(act) + '</button>';
      }).join('') +
      '</div></div>' +
      '</div>' +

      '<div id="sizes-container" style="margin-top:16px;"></div>' +

      '<div class="field-row" style="margin-top:16px;">' +
      UI.field('Total Opportunity Size (₹)',
        '<input class="input" type="number" name="initialPotential" min="0" step="any" inputmode="decimal" readonly required>',
        'Auto-aggregated sum of all selected opportunity sizes.') +
      '</div>' +

      '<div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button></div>' +
      '</form>',

      function (host) {
        var selectedOfferings = [];
        var selectedBagless = [];
        var sizesContainer = host.querySelector('#sizes-container');
        var baglessContainer = host.querySelector('#bagless-container');
        var totalInput = host.querySelector('[name=initialPotential]');

        function updateSizesAndTotals() {
          sizesContainer.innerHTML = '';
          var activeItems = [];
          selectedOfferings.forEach(function (off) {
            if (off === 'Bagless') {
              selectedBagless.forEach(function (b) {
                activeItems.push({ key: 'Bagless', variant: b, label: 'Bagless: ' + b, isBagless: true });
              });
            } else {
              activeItems.push({ key: off, variant: null, label: V.offeringLabel[off] || off, isBagless: false });
            }
          });

          activeItems.forEach(function (item, idx) {
            var q = M.priceFor(item.key, item.variant, school.students);
            var defaultVal = q && q.value ? Math.round(q.value) : '';
            var defaultStudents = item.isBagless ? (school.students || '') : '';

            var fieldHtml = '<div class="field-row" style="margin-top:12px;" data-size-row="' + idx + '">' +
              (item.isBagless ? UI.field(item.label + ' Student Strength', '<input class="input item-students-input" type="number" min="0" step="1" inputmode="numeric" data-key="' + U.esc(item.key) + '" data-variant="' + U.esc(item.variant || '') + '" value="' + defaultStudents + '" placeholder="No. of students">') : '') +
              UI.field(item.label + ' Size (₹)', '<input class="input item-size-input" type="number" min="0" step="any" data-key="' + U.esc(item.key) + '" data-variant="' + U.esc(item.variant || '') + '" value="' + defaultVal + '" required>') +
              '</div>';
            sizesContainer.insertAdjacentHTML('beforeend', fieldHtml);
          });

          sizesContainer.querySelectorAll('.item-size-input').forEach(function (inp) {
            inp.addEventListener('input', recalculateTotal);
          });

          recalculateTotal();
        }

        function recalculateTotal() {
          var sum = 0;
          sizesContainer.querySelectorAll('.item-size-input').forEach(function (inp) {
            sum += Number(inp.value) || 0;
          });
          totalInput.value = sum;
        }

        host.querySelectorAll('[data-choice-multi=offering] button').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var val = btn.getAttribute('data-value');
            var pressed = btn.getAttribute('aria-pressed') === 'true';
            btn.setAttribute('aria-pressed', !pressed);

            if (!pressed) {
              if (selectedOfferings.indexOf(val) === -1) selectedOfferings.push(val);
            } else {
              selectedOfferings = selectedOfferings.filter(function (x) { return x !== val; });
            }

            baglessContainer.hidden = selectedOfferings.indexOf('Bagless') === -1;
            updateSizesAndTotals();
          });
        });

        host.querySelectorAll('[data-choice-multi=bagless] button').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var val = btn.getAttribute('data-value');
            var pressed = btn.getAttribute('aria-pressed') === 'true';
            btn.setAttribute('aria-pressed', !pressed);

            if (!pressed) {
              if (selectedBagless.indexOf(val) === -1) selectedBagless.push(val);
            } else {
              selectedBagless = selectedBagless.filter(function (x) { return x !== val; });
            }
            updateSizesAndTotals();
          });
        });

        host.querySelector('#f').addEventListener('submit', function (e) {
          e.preventDefault();
          if (selectedOfferings.length === 0) return UI.toast('Pick at least one opportunity type.');

          var collectedOpportunities = [];
          sizesContainer.querySelectorAll('[data-size-row]').forEach(function (row) {
            var sizeInp = row.querySelector('.item-size-input');
            var studInp = row.querySelector('.item-students-input');

            collectedOpportunities.push({
              offering: sizeInp.getAttribute('data-key'),
              variant: sizeInp.getAttribute('data-variant') || null,
              initialPotential: Number(sizeInp.value) || 0,
              studentCount: studInp ? (Number(studInp.value) || null) : null
            });
          });

          if (collectedOpportunities.length === 0) return UI.toast('Please select valid opportunity items.');

          d.opportunityQueue = collectedOpportunities;
          d.opportunityQueueIndex = 0;
          stepConnectLoop();
        });
      });
  }
  /* 2b / 3. The opportunity.
   *
   * The size is quoted off the CEO's rate card - price x (this school's
   * students / the base count that price buys) - so potential revenue is
   * tracked before any negotiation. It stays editable: the rate card is the
   * list price, not the deal. */

  /* ======================================= EXISTING SCHOOL CONNECT ==== */
  /* 1. Search the school. */
  function stepSearchSchool() {
    var recent = recentSchools();
    shell('Existing school',
      '<input class="input" id="q" type="search" placeholder="Search school name…" autocomplete="off">' +
      '<div class="section-title" id="lbl">Recent</div><div class="pick-list" id="list"></div>',
      function (host) {
        var list = host.querySelector('#list'), q = host.querySelector('#q');
        draw(recent); q.focus();
        q.addEventListener('input', U.debounce(function () {
          var t = q.value.trim().toLowerCase();
          host.querySelector('#lbl').textContent = t ? 'Matches' : 'Recent';
          draw(t ? RB.store.schools().filter(function (s) {
            return (s.name + ' ' + (s.location || '')).toLowerCase().indexOf(t) !== -1;
          }).slice(0, 20) : recent);
        }, 140));

        function draw(items) {
          list.innerHTML = items.length ? items.map(function (s) {
            var n = RB.store.opportunitiesFor(s.id).filter(function (o) { return o.status === 'Open'; }).length;
            return '<button type="button" class="pick" data-id="' + U.esc(s.id) + '">' +
              '<span class="pick-main"><strong>' + U.esc(s.name) + '</strong><small>' +
              U.esc([s.location, s.region, s.board].filter(Boolean).join(' · ')) + '</small></span>' +
              '<span class="pick-right small muted">' + n + ' open</span></button>';
          }).join('') : '<div class="empty">No school matches. Start a New School Connect instead.</div>';
          list.querySelectorAll('[data-id]').forEach(function (b) {
            b.addEventListener('click', function () { d.schoolId = b.getAttribute('data-id'); stepPickOpportunity(); });
          });
        }
      });
  }

  function recentSchools() {
    var me = RB.auth.user(), seen = [], out = [];
    RB.store.connects().slice().sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    }).forEach(function (c) {
      if (out.length >= 8 || seen.indexOf(c.schoolId) !== -1) return;
      var s = RB.store.schoolById(c.schoolId);
      if (!s || (me.role === 'sales' && s.ownerKey !== me.ownerKey)) return;
      seen.push(c.schoolId); out.push(s);
    });
    return out;
  }

  /* 2. Existing opportunity, or a new one at the same school. */
  function stepPickOpportunity() {
    var school = RB.store.schoolById(d.schoolId);
    var opps = RB.store.opportunitiesFor(d.schoolId).map(M.view)
      .filter(function (v) { return v.status === 'Open'; });

    shell(school.name,
      '<p class="sec small" style="margin-top:0">Existing opportunity, or a new one at this school?</p>' +
      '<div class="pick-list">' +
      opps.map(function (v) {
        return '<button type="button" class="pick" data-id="' + U.esc(v.opp.id) + '">' +
          '<span class="pick-main"><strong>' + U.esc(v.opp.offering || 'Opportunity') + '</strong><small>' +
          U.esc(v.stage + (v.lastAt ? ' · last ' + U.fmtDate(v.lastAt) : '')) + '</small></span>' +
          '<span class="pick-right"><strong>' + U.esc(U.money(v.current)) + '</strong></span></button>';
      }).join('') +
      '<button type="button" class="pick" data-new="1"><span class="pick-main">' +
      '<strong>+ New (additional opportunity)</strong><small>A different offering at this school</small>' +
      '</span></button></div>',
      function (host) {
        host.querySelectorAll('[data-id]').forEach(function (b) {
          b.addEventListener('click', function () { d.opportunityId = b.getAttribute('data-id'); stepContext(); });
        });
        host.querySelector('[data-new]').addEventListener('click', stepOpportunity);
      });
  }

  /* 3. Current opportunity + context. */
  function stepContext() {
    var v = M.view(RB.store.opportunityById(d.opportunityId));
    shell(v.school.name + ' · context',
      '<form id="f">' +
      '<div class="field-row">' +
      UI.field('Existing program / lab', '<input class="input" name="existingProgram" value="' +
        U.esc(v.school.labType || (v.school.competitor !== 'None' ? v.school.competitor : '')) + '">') +
      UI.field('Current need', '<input class="input" name="currentNeed" value="' + U.esc(v.opp.currentNeed || '') + '">') +
      '</div>' +
      '<div class="field-row">' +
      UI.field('Decision maker', '<input class="input" name="decisionMaker" value="' + U.esc(v.opp.decisionMaker || '') + '">') +
      UI.field('Owner', UI.select('ownerKey', owners(), v.owner || RB.auth.user().ownerKey)) +
      '</div>' +
      '<div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button></div>' +
      '</form>',
      function (host) {
        host.querySelector('#f').addEventListener('submit', function (e) {
          e.preventDefault();
          var f = UI.values(this);
          RB.store.updateOpportunity(d.opportunityId, {
            currentNeed: f.currentNeed || null,
            decisionMaker: f.decisionMaker || null,
            ownerKey: f.ownerKey || null
          });
          if (f.existingProgram) RB.store.updateSchool(d.schoolId, { labType: f.existingProgram });
          stepConnect();
        });
      });
  }

  /* ================================= the connect itself (both flows) === */
  function stepConnect() {
    var isNew = d.kind === 'New';
    var v = d.opportunityId ? M.view(RB.store.opportunityById(d.opportunityId)) : null;
    var schoolName = v ? v.school.name : draftSchool().name;
    var contacts = d.schoolId ? RB.store.contactsFor(d.schoolId) : [];
    var prev = v && v.last;
    var today = U.iso(U.today());

    shell(schoolName + ' · connect',
      (prev
        ? '<div class="prev-connect"><div class="pc-label">Previous connect</div>' +
        U.esc([prev.at ? U.fmtDate(prev.at.slice(0, 10)) : 'undated', prev.mode,
        prev.response, prev.nextAction ? 'next: ' + prev.nextAction : null]
          .filter(Boolean).join(' · ')) + '</div>'
        : '') +
      '<form id="f">' +

      '<div class="cx-step"><h3>Type of connect</h3>' +
      UI.choice('mode', V.connectMode, null, { tight: true }) + '</div>' +

      '<div class="field-row">' +
      UI.field('Date of connect', '<input class="input" type="date" name="date" value="' + today + '" max="' + today + '" required>') +
      UI.field(isNew ? 'Contact person / decision maker' : 'Contact person',
        contacts.length
          ? UI.select('contactId', contacts.map(function (c) { return { value: c.id, label: c.name + (c.role ? ' — ' + c.role : '') }; })
            .concat([{ value: '__new', label: '+ New contact' }]), contacts[0].id)
          : '<input class="input" name="contactName" placeholder="Name">') +
      '</div>' +
      '<div id="new-contact" hidden></div>' +

      '<div class="cx-step"><h3>Response / outcome</h3>' +
      UI.choice('response', V.response, null, { tight: true }) + '</div>' +

      '<div id="blocker-step" hidden></div>' +

      '<div class="cx-step" id="next-step"><h3>Next action</h3>' +
      '<p class="field-hint" style="margin:-6px 0 12px">No connect is complete until action, owner and follow-up date are captured.</p>' +
      '<div class="field-row">' +
      UI.field('Action', UI.select('nextAction', V.nextAction, null, { placeholder: 'Select action', required: true })) +
      UI.field('Owner', UI.select('nextActionOwner', owners(), RB.auth.user().ownerKey, { required: true })) +
      UI.field('Follow-up date', '<input class="input" type="date" name="nextDate" value="' + U.addDays(today, 7) + '" required>') +
      '</div></div>' +

      '<div class="cx-step"><h3>Pipeline stage</h3>' +
      UI.choice('stage', V.stage, null, { tight: true }) + '</div>' +

      '<div class="cx-step" id="commercial"><h3>Expected deal size &amp; closure</h3>' +
      '<div class="field-row">' +
      UI.field('Expected deal size (₹)', '<input class="input" type="number" name="expectedValue" min="0" step="any" inputmode="decimal" value="' +
        (v && v.current != null ? v.current : (d.opportunity ? d.opportunity.initialPotential : '')) + '">') +
      UI.field('Expected closure date', '<input class="input" type="date" name="expectedClosure" value="' +
        U.esc(v && v.expectedClosure ? v.expectedClosure : '') + '">') +
      UI.field('Probability (%)', UI.select('probability', V.probability, v && v.probability != null ? String(v.probability) : null, { placeholder: 'Select' })) +
      UI.field('Sales year',
        UI.select('salesYear', V.salesYear,
          v && v.salesYear ? v.salesYear : M.currentSalesYear(), { required: true }),
        'Which year this sale counts towards. A workshop or bagless activity ' +
        'is usually this year; a lab for next session is the year after.') +
      '</div>' +
      kitBandFields() +
      '<p class="field-hint" id="floor-hint"></p>' +
      UI.field('Remarks', '<input class="input" name="remarks" placeholder="Optional">') +
      '</div>' +

      '<div id="close-wrap"></div>' +

      '<div class="modal-actions">' +
      '<button type="submit" class="btn btn-primary btn-lg btn-block">' +
      (isNew ? 'Save lead' : 'Save school + opportunity') + '</button></div>' +
      '</form>',
      function (host) {
        var blockerStep = host.querySelector('#blocker-step');

        /* Why the deal was turned down is only worth asking once it has been.
         * On any other outcome the blocker list is not shown at all, so
         * nothing gets a blocker by default. */
        function showBlockers(rejected) {
          blockerStep.hidden = !rejected;
          blockerStep.innerHTML = rejected
            ? '<div class="cx-step"><h3>Why was it rejected?</h3>' +
            UI.choice('blocker', V.blocker.filter(function (b) { return b !== 'None'; }),
              null, { tight: true }) +
            '<div id="blocker-detail" hidden style="margin-top:12px"></div></div>'
            : '';
          if (rejected) UI.bindChoices(blockerStep, onPick);
        }
        var closeWrap = host.querySelector('#close-wrap');
        var stageGroup = host.querySelector('[data-choice="stage"]');
        var stageHidden = host.querySelector('input[name="stage"]');

        function onPick(name, val) {
          if (name === 'response' || name === 'mode') {
            // Pre-select the stage the response implies; the rep can override.
            var f = UI.values(host.querySelector('#f'));
            if (!d.stageTouched) setStage(M.suggestStage(f.response, f.mode));
            if (name === 'response') showBlockers(val === 'Rejected');
          }
          if (name === 'stage') {
            d.stageTouched = true;
            showClose(M.CLOSED[val] && val !== 'Won' ? val : null);
          }
          if (name === 'blocker') {
            var detail = host.querySelector('#blocker-detail');
            detail.hidden = false;
            detail.innerHTML = UI.field('Blocker detail (optional)',
              '<input class="input" name="blockerDetail">');
          }
        }
        UI.bindChoices(host, onPick);
        showBlockers(false);

        /* Lost or On Hold: the reason is the only question left. Hidden inputs
         * keep their `required` flag, and a hidden required field the browser
         * cannot focus blocks submit with no message at all — so the flag comes
         * off with the block. */
        function showClose(stage) {
          var closing = !!stage;
          [host.querySelector('#next-step'), host.querySelector('#commercial')].forEach(function (el) {
            el.hidden = closing;
            el.querySelectorAll('[required]').forEach(function (i) {
              if (closing) { i.dataset.wasRequired = '1'; i.required = false; }
            });
            if (!closing) {
              el.querySelectorAll('[data-was-required]').forEach(function (i) { i.required = true; });
            }
          });
          closeWrap.innerHTML = closing ? closeFields(stage) : '';
          if (!closing) return;
          var pick = closeWrap.querySelector('[name=lossReason]');
          var note = closeWrap.querySelector('#reason-note');
          pick.addEventListener('change', function () {
            var other = pick.value === 'Other';
            note.hidden = !other;
            note.innerHTML = other
              ? UI.field('Tell us more', '<textarea class="input" name="lossReasonNote" ' +
                'placeholder="Why, in your words" required></textarea>')
              : '';
          });
        }

        function setStage(stage) {
          stageGroup.querySelectorAll('button').forEach(function (b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-value') === stage);
          });
          stageHidden.value = stage;
          showClose(M.CLOSED[stage] && stage !== 'Won' ? stage : null);
        }

        var contactSel = host.querySelector('select[name="contactId"]');
        if (contactSel) contactSel.addEventListener('change', function () {
          var nc = host.querySelector('#new-contact');
          nc.hidden = this.value !== '__new';
          nc.innerHTML = this.value !== '__new' ? '' :
            '<div class="field-row">' +
            UI.field('Name', '<input class="input" name="contactName">') +
            UI.field('Role', UI.select('contactRole', V.contactRole, null, { placeholder: 'Select' })) +
            UI.field('Phone', '<input class="input" type="tel" name="contactPhone">') + '</div>';
        });

        var form = host.querySelector('#f');
        wireFloor(form);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          submit(UI.values(this), this);
        });
      });
  }

  /* A deal that stops needs one thing: why. Everything else on the form is
   * about a deal that is still moving, so it comes off the screen. */
  /* Robobox Kits are bought by standard, not by school: the same kit covers
   * Sr KG to 2nd, another covers 3rd to 5th, and so on. Ask how many students
   * sit in each band the school is actually buying for, and the price falls
   * out of that. Only shown for that product. */
  /* What is being sold, from whichever path got here: the new-school flow
   * stashes a draft on `d.opportunity`, the existing-school flow carries an
   * id. Both end up in the same connect form, so both have to be read. */
  function dealContext() {
    var opp = d.opportunity ||
      (d.opportunityId ? RB.store.opportunityById(d.opportunityId) : null) || {};
    var school = d.schoolId ? RB.store.schoolById(d.schoolId) : null;
    if (!school && d.school) school = d.school;
    return {
      offering: opp.offering || null,
      variant: opp.variant || null,
      students: school ? school.students : null
    };
  }

  function kitBandFields() {
    var row = (M.CATALOGUE || []).filter(function (c) { return c.key === dealContext().offering; })[0];
    if (!row || !row.bands) return '';
    return '<div id="kit-bands" style="margin-top:6px">' +
      '<span class="field-label">Students by standard</span>' +
      '<div class="field-row">' +
      row.bands.map(function (b) {
        return UI.field(b.label,
          '<input class="input" type="number" min="0" step="1" inputmode="numeric" ' +
          'data-band="' + U.esc(b.key) + '" placeholder="0">',
          U.money(b.sp) + ' each, floor');
      }).join('') +
      '</div></div>';
  }

  /* Read the band boxes back off the form. */
  function bandCounts(form) {
    var out = null;
    form.querySelectorAll('[data-band]').forEach(function (i) {
      var n = Number(i.value || 0);
      if (n > 0) { out = out || {}; out[i.getAttribute('data-band')] = n; }
    });
    return out;
  }

  /* The floor, live, as the deal size is typed. The team may pitch at MRP and
   * settle anywhere down to this, and no lower. */
  function wireFloor(form) {
    var hint = form.querySelector('#floor-hint');
    if (!hint) return;
    var box = form.querySelector('[name="expectedValue"]');

    function quote() {
      var c = dealContext();
      if (!c.offering) return null;
      return M.priceFor(c.offering, c.variant, c.students, { bands: bandCounts(form) });
    }

    function show() {
      var q = quote();
      if (!q || q.sp == null) { hint.textContent = ''; hint.classList.remove('is-bad'); return; }
      var floor = q.sp;
      var typed = Number(box && box.value || 0);
      var under = typed > 0 && typed < floor - 0.5;
      hint.innerHTML = 'Pitch ' + U.esc(U.money(q.mrp)) + ' · floor ' + U.esc(U.money(floor)) +
        (under ? ' — <strong>below the minimum operating price</strong>' : '');
      hint.style.color = under ? 'var(--red)' : '';
      form.dataset.floor = String(floor);
    }

    show();
    if (box) box.addEventListener('input', show);
    // For kits the bands ARE the deal size, so the box follows them. Typing
    // over it afterwards still works - until the bands change again.
    form.querySelectorAll('[data-band]').forEach(function (i) {
      i.addEventListener('input', function () {
        var q = quote();
        if (box && q && q.byBand) box.value = q.sp ? Math.round(q.sp) : '';
        show();
      });
    });
  }

  function closeFields(stage) {
    return '<div class="cx-step"><h3>' +
      (stage === 'On Hold' ? 'Why is it on hold?' : 'Why was it lost?') + '</h3>' +
      UI.field('Reason', UI.select('lossReason', V.lossReason, null,
        { placeholder: 'Select a reason', required: true })) +
      '<div id="reason-note" hidden></div></div>';
  }

  function submit(f, form) {
    if (!f.mode) return UI.toast('Pick the type of connect.');
    if (!f.response) return UI.toast('Record the response.');
    if (!f.stage) return UI.toast('Set the pipeline stage.');

    var stopped = M.CLOSED[f.stage] && f.stage !== 'Won';
    if (stopped) {
      if (!f.lossReason) return UI.toast('Pick a reason.');
      if (f.lossReason === 'Other' && !String(f.lossReasonNote || '').trim()) {
        return UI.toast('Tell us the reason.');
      }
    } else if (!f.nextAction || !f.nextActionOwner || !f.nextDate) {
      return UI.toast('Next action, owner and follow-up date are all required.');
    }

    // Create the school and opportunity now, so an abandoned form leaves nothing.
    if (d.school && !d.schoolId) d.schoolId = RB.store.addSchool(d.school).id;
    if (d.opportunity && !d.opportunityId) {
      d.opportunityId = RB.store.addOpportunity(Object.assign({
        schoolId: d.schoolId, ownerKey: RB.auth.user().ownerKey
      }, d.opportunity)).id;
    }

    var contactId = f.contactId && f.contactId !== '__new' ? f.contactId : null;
    if (!contactId && f.contactName) {
      contactId = RB.store.addContact({
        schoolId: d.schoolId, name: f.contactName,
        role: f.contactRole || null, phone: f.contactPhone || null
      }).id;
    }

    // The floor is a commercial rule, not a suggestion: a deal below the
    // minimum operating price does not get saved.
    var floor = Number((form && form.dataset.floor) || 0);
    var asked = f.expectedValue ? Number(f.expectedValue) : 0;
    if (floor && asked && asked < floor - 0.5) {
      UI.toast('That is below the minimum operating price of ' + U.money(floor) + '.');
      return;
    }

    var closed = M.CLOSED[f.stage];
    RB.store.logConnect({
      schoolId: d.schoolId, opportunityId: d.opportunityId, by: RB.auth.user().id,
      kind: d.kind === 'New' ? 'New' : 'Reconnect',
      mode: f.mode, contactId: contactId, response: f.response,
      blocker: f.blocker || 'None', blockerDetail: f.blockerDetail || null,
      stage: f.stage,
      expectedValue: f.expectedValue ? Number(f.expectedValue) : null,
      probability: f.probability ? Number(f.probability) : null,
      expectedClosure: f.expectedClosure || null,
      salesYear: f.salesYear || null,
      kitBands: (form && bandCounts(form)) || null,
      remarks: stopped ? (f.lossReasonNote || null) : (f.remarks || null),
      nextAction: stopped ? 'No Further Action' : f.nextAction,
      nextActionOwner: stopped ? null : f.nextActionOwner,
      nextActionAt: stopped ? null : f.nextDate + 'T11:00:00',
      at: f.date + 'T' + new Date().toTimeString().slice(0, 8),
      // On Hold closes the deal too — it just closes it differently.
      close: closed
        ? {
          status: closed, reason: f.lossReason || null,
          value: f.expectedValue ? Number(f.expectedValue) : null
        }
        : null
    });

    UI.closeModal();
    UI.toast(closed ? 'Marked ' + closed + '.' : 'Connect saved · follow-up ' + U.fmtDate(f.nextDate),
      { label: 'Log another', run: function () { open(); } });
    RB.app.refresh();
  }

  return { open: open };
})();
