  const MAX_SIDE = 1024;
  const $ = id => document.getElementById(id);
  const drop = $('drop'), fileInput = $('file'), preview = $('preview');
  const analyze = $('analyze'), suggest = $('suggest'), moreBtn = $('moreBtn');
  const status = $('status'), errorBox = $('error');
  let blob = null;
  let ingredients = [];
  let maybe = [];
  let shownDishes = [];

  // Phones: never open the library picker with input.click().
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse) {
    drop.removeAttribute('role');
    drop.removeAttribute('tabindex');
  } else {
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  }
  function onPicked(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) setImage(f);
  }
  fileInput.addEventListener('change', () => onPicked(fileInput));

  // Take a photo goes through getUserMedia, which is what makes the browser ask Allow / Block.
  const camView = $('camView');
  const camSheet = $('cameraSheet');
  let camStream = null;
  camView.muted = true;
  camView.playsInline = true;

  $('takePhoto').addEventListener('click', openCamera);
  $('camClose').addEventListener('click', () => camSheet.close());
  $('camShot').addEventListener('click', snapCamera);
  camSheet.addEventListener('close', () => { stopCamera(); $('camProbe').appendChild(camView); });

  function cameraAllowed() {
    return window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  }

  if (!cameraAllowed()) {
    $('takePhoto').hidden = true;
    $('cameraHint').textContent = 'For security reasons the camera is not available. Choose a photo from your gallery or files.';
  } else {
    $('cameraHint').textContent = 'Take a photo asks the browser for the camera.';
  }

  async function openCamera() {
    hideError();
    if (!cameraAllowed()) {
      showError('For security reasons the camera is not available. Choose a photo from your gallery or files.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err) {
      if (err && err.name === 'OverconstrainedError') {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
        catch (err2) { showError(cameraError(err2)); return; }
      } else {
        showError(cameraError(err)); return;
      }
    }
    camStream = stream;
    $('camProbe').appendChild(camView);
    camView.srcObject = stream;
    try { await camView.play(); } catch (err) { /* autoplay already started it */ }
    const picture = await waitForPicture(camView);
    if (!picture) {
      stopCamera();
      showError('The camera did not give a picture, so it was not opened. Use Choose a photo instead.');
      return;
    }
    $('camSlot').appendChild(camView);
    $('camShot').disabled = false;
    $('camStatus').textContent = '';
    camSheet.showModal();
  }

  function nextFrame(video) {
    return new Promise(resolve => {
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => resolve());
      else requestAnimationFrame(() => resolve());
      setTimeout(resolve, 400);
    });
  }

  async function waitForPicture(video) {
    const start = performance.now();
    while (performance.now() - start < 1200) {
      await nextFrame(video);
      if (video.videoWidth && !frameIsBlack(video)) return true;
    }
    return false;
  }

  function frameIsBlack(video) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, 0, 0, 16, 16);
    const data = g.getImageData(0, 0, 16, 16).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) lit++;
    }
    return lit < 4;
  }

  function cameraError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
      return 'Camera blocked. Choose Allow in the browser prompt, or allow Camera for this site in the address bar, then tap Take a photo again.';
    if (name === 'NotFoundError') return 'No camera was found on this device.';
    if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
    return 'Could not open the camera. Use Choose a photo instead.';
  }

  function stopCamera() {
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    camView.srcObject = null;
  }

  function snapCamera() {
    const w = camView.videoWidth, h = camView.videoHeight;
    if (!w || !h) { $('camStatus').textContent = 'The camera has not produced a picture yet.'; return; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(camView, 0, 0);
    canvas.toBlob(b => {
      if (!b) { showError('Could not save that photo.'); camSheet.close(); return; }
      camSheet.close();
      setImage(new File([b], 'fridge.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) setImage(f); else showError('Please drop an image file.');
  });

  async function setImage(file) {
    hideError();
    resetResults();
    try {
      blob = await resize(file);
    } catch (err) {
      showError('Could not read that image.');
      return;
    }
    if (await looksBlank(blob)) {
      blob = null;
      preview.style.display = 'none';
      analyze.disabled = true;
      showError('That picture is blank, so it was not used. For security reasons the camera is not available. Choose a photo from your gallery or files.');
      return;
    }
    preview.style.display = 'none';
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
    drop.querySelector('p').textContent = 'Drop another photo to replace it.';
    analyze.disabled = false;
  }

  function looksBlank(file) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const c = document.createElement('canvas');
        c.width = 16; c.height = 16;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 16, 16);
        const data = g.getImageData(0, 0, 16, 16).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) lit++;
        }
        resolve(lit < 4);
      };
      img.onerror = () => resolve(false);
      img.src = URL.createObjectURL(file);
    });
  }

  function resize(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        if (scale === 1 && file.type === 'image/jpeg') return resolve(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // Step 1: photo -> ingredients
  analyze.addEventListener('click', async () => {
    if (!blob) return;
    hideError();
    resetResults();
    setBusy(true, 'vision');
    const form = new FormData();
    form.append('image', blob, 'fridge.jpg');
    form.append('language', $('lang').value);
    try {
      const body = await api('/api/ingredients', { method: 'POST', body: form });
      ingredients = body.ingredients || [];
      maybe = body.maybe || [];
      renderIngredients();
      $('ingredientsCard').style.display = 'block';
    } catch (err) {
      showError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  });

  // Step 2: ingredients -> recipes
  suggest.addEventListener('click', () => fetchRecipes([]));
  moreBtn.addEventListener('click', () => fetchRecipes(shownDishes));

  async function fetchRecipes(avoid) {
    if (!ingredients.length) { showError('Add at least one ingredient first.'); return; }
    hideError();
    setBusy(true, avoid.length ? 'different' : 'recipes');
    try {
      const body = await api('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients, language: $('lang').value, avoid }),
      });
      renderRecipes(body.recipes || [], body.model);
      shownDishes = shownDishes.concat(body.recipes.map(r => r.dish));
    } catch (err) {
      showError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = body.detail;
      throw new Error(typeof d === 'string' ? d : `Server error (${res.status})`);
    }
    return body;
  }

  $('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('addInput').value.trim();
    if (v && !ingredients.includes(v)) { ingredients.push(v); renderIngredients(); }
    $('addInput').value = '';
  });

  // Chips already on screen keep still; only new ones pop in.
  const seenChips = new Set();
  function renderIngredients() {
    const list = $('ingredients');
    list.innerHTML = '';
    list.classList.toggle('empty', !ingredients.length);
    if (!ingredients.length) list.textContent = 'Nothing confirmed yet. Add something below.';
    let n = 0;
    ingredients.forEach((t, i) => {
      const c = chip(t, '', '×', 'Remove', () => { ingredients.splice(i, 1); renderIngredients(); });
      if (seenChips.has(t)) c.classList.add('settled'); else { stagger(c, n++); seenChips.add(t); }
      list.appendChild(c);
    });
    const mb = $('maybe');
    mb.innerHTML = '';
    maybe.forEach((t, i) => {
      const c = chip(t, 'maybe', '+', 'Confirm', () => {
        maybe.splice(i, 1);
        if (!ingredients.includes(t)) ingredients.push(t);
        renderIngredients();
      });
      if (seenChips.has('?' + t)) c.classList.add('settled'); else { stagger(c, n++); seenChips.add('?' + t); }
      mb.appendChild(c);
    });
    $('maybeBlock').style.display = maybe.length ? '' : 'none';
  }

  function chip(text, cls, symbol, title, onClick) {
    const s = document.createElement('span');
    s.className = 'chip ' + cls;
    s.append(text);
    if (onClick) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = symbol; b.title = title; b.setAttribute('aria-label', `${title} ${text}`);
      b.addEventListener('click', () => leave(s, onClick));
      s.appendChild(b);
    }
    return s;
  }

  function renderRecipes(list, model) {
    const box = $('recipes');
    box.innerHTML = '';
    list.forEach((r, i) => {
      const saved = isSaved(r.dish);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn small';
      btn.textContent = saved ? 'Saved ✓' : 'Save';
      btn.disabled = saved;
      btn.addEventListener('click', () => {
        saveRecipe({ ...r, model, ingredients: [...ingredients], savedAt: Date.now() });
        btn.textContent = 'Saved ✓'; btn.disabled = true;
      });
      box.appendChild(recipeCard(r, model, btn, i));
    });
    box.style.display = 'block';
    $('more').style.display = 'flex';
    box.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }

  function recipeCard(r, model, actionBtn, index) {
    const card = document.createElement('article');
    card.className = 'card rise lift';
    stagger(card, index);
    const h = document.createElement('h2'); h.textContent = r.dish || '—';
    const meta = document.createElement('div'); meta.className = 'meta';
    const num = document.createElement('span'); num.className = 'num'; num.textContent = r.minutes ?? '?';
    meta.append(num, ' min' + (model ? ` · ${model}` : ''));
    card.append(h, meta);
    if (Number.isInteger(r.minutes)) countUp(num, r.minutes, index);
    const sh = document.createElement('h3'); sh.textContent = 'Steps';
    const ol = document.createElement('ol');
    (r.steps || []).forEach(s => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
    card.append(sh, ol);
    if ((r.missing || []).length) {
      const mh = document.createElement('h3'); mh.textContent = 'Not in your fridge';
      const chips = document.createElement('div'); chips.className = 'chips';
      r.missing.forEach((m, i) => { const c = chip(m, 'missing'); stagger(c, i); chips.appendChild(c); });
      card.append(mh, chips);
    }
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.appendChild(actionBtn);
    card.appendChild(actions);
    return card;
  }

  // Saved recipes (localStorage only, nothing leaves the browser)
  const SAVED_KEY = 'fridge-to-dinner.saved';
  function loadSaved() { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; } }
  function storeSaved(list) { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); updateSavedCount(); }
  function isSaved(dish) { return loadSaved().some(s => s.dish === dish); }
  function saveRecipe(r) { if (!isSaved(r.dish)) storeSaved([r, ...loadSaved()]); }
  function removeRecipe(dish) { storeSaved(loadSaved().filter(s => s.dish !== dish)); renderSaved(); }
  function updateSavedCount() {
    const n = loadSaved().length;
    $('navSaved').textContent = n ? `Saved recipes (${n})` : 'Saved recipes';
  }

  function renderSaved() {
    const box = $('savedList');
    box.innerHTML = '';
    loadSaved().forEach((r, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Remove';
      const card = recipeCard(r, r.model, btn, i);
      btn.addEventListener('click', () => leave(card, () => removeRecipe(r.dish)));
      box.appendChild(card);
    });
  }

  function showView(name) {
    $('cookView').style.display = name === 'cook' ? '' : 'none';
    $('savedView').style.display = name === 'saved' ? 'block' : 'none';
    $('navCook').classList.toggle('active', name === 'cook');
    $('navSaved').classList.toggle('active', name === 'saved');
    $('navCook').setAttribute('aria-selected', name === 'cook');
    $('navSaved').setAttribute('aria-selected', name === 'saved');
    if (name === 'saved') renderSaved();
  }
  $('navCook').addEventListener('click', () => showView('cook'));
  $('navSaved').addEventListener('click', () => showView('saved'));
  updateSavedCount();

  function resetResults() {
    ingredients = []; maybe = []; shownDishes = [];
    seenChips.clear();
    $('ingredientsCard').style.display = 'none';
    $('recipes').style.display = 'none';
    $('recipes').innerHTML = '';
    $('more').style.display = 'none';
  }

  // Loading state: rotating status line, skeleton, button progress
  const PHRASES = {
    vision: ['Looking at your fridge…', 'Spotting what is on the shelves…', 'Reading the labels…', 'Choosing ingredients…'],
    recipes: ['Choosing ingredients…', 'Writing recipes…', 'Keeping it lazy…', 'Checking the timings…'],
    different: ['Thinking of something different…', 'Changing the cuisine…', 'Writing recipes…', 'Checking the timings…'],
  };
  const PHASE_BUTTON = { vision: analyze, recipes: suggest, different: moreBtn };
  let statusTimer = null;

  function setBusy(busy, phase) {
    clearInterval(statusTimer);
    document.body.classList.toggle('busy', busy);
    document.body.dataset.phase = busy ? phase : '';
    [analyze, suggest, moreBtn].forEach(b => b.classList.toggle('loading', busy && PHASE_BUTTON[phase] === b));
    analyze.disabled = busy || !blob;
    suggest.disabled = busy;
    moreBtn.disabled = busy;
    if (!busy) { setStatus(''); return; }
    const lines = PHRASES[phase];
    let i = 0;
    setStatus(lines[0]);
    statusTimer = setInterval(() => { i = (i + 1) % lines.length; setStatus(lines[i]); }, 2800);
  }

  function setStatus(text) {
    const old = status.querySelector('.status-line:not(.out)');
    if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 250); }
    if (!text) return;
    const line = document.createElement('span');
    line.className = 'status-line'; line.textContent = text;
    status.appendChild(line);
  }

  // Motion helpers
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function stagger(el, i) { el.style.setProperty('--i', Math.min(i, 7)); }

  function leave(el, done) {
    if (reduceMotion.matches) return done();
    let finished = false;
    const finish = () => { if (finished) return; finished = true; done(); };
    el.classList.add('leaving');
    el.style.willChange = 'transform, opacity';
    el.addEventListener('animationend', e => { if (e.target === el) finish(); });
    setTimeout(finish, 300);
  }

  function countUp(el, target, index) {
    if (reduceMotion.matches || target <= 0) return;
    const duration = 600, delay = Math.min(index, 7) * 70;
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    let start = null;
    el.textContent = '0';
    function frame(ts) {
      if (start === null) start = ts + delay;
      const t = Math.min(1, Math.max(0, (ts - start) / duration));
      el.textContent = Math.round(easeOut(t) * target);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    errorBox.style.animation = 'none';
    void errorBox.offsetWidth;
    errorBox.style.animation = '';
    errorBox.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
  }
  function hideError() { errorBox.style.display = 'none'; }
