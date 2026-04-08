(function() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isDevParam = new URLSearchParams(window.location.search).has('dev');
  if (!isLocal && !isDevParam) return;

  const css = `
    #dev-tools-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #c9a84c;
      color: #0d1b2a;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      font-size: 20px;
      transition: transform 0.2s;
    }
    #dev-tools-toggle:hover { transform: scale(1.1); }
    
    #dev-tools-menu {
      position: fixed;
      bottom: 75px;
      right: 20px;
      background: #1a2d42;
      border: 1px solid rgba(201,168,76,0.3);
      border-radius: 12px;
      padding: 12px;
      display: none;
      flex-direction: column;
      gap: 8px;
      z-index: 9998;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      width: 240px;
      max-height: 80vh;
      overflow-y: auto;
    }
    #dev-tools-menu.visible { display: flex; animation: devFadeIn 0.2s ease; }
    
    #dev-tools-menu .dev-section {
      margin-bottom: 8px;
    }
    #dev-tools-menu .dev-header {
      font-size: 10px;
      text-transform: uppercase;
      color: #5a7491;
      margin-bottom: 6px;
      padding-left: 2px;
      letter-spacing: 0.1em;
      font-weight: 700;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding-bottom: 4px;
    }
    
    #dev-tools-menu button, #dev-tools-menu a {
      color: #eef2f7;
      text-decoration: none;
      font-size: 12px;
      font-family: 'Inter', sans-serif;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,0.05);
      transition: all 0.2s;
      border: none;
      text-align: left;
      cursor: pointer;
      display: block;
      width: 100%;
      margin-bottom: 4px;
    }
    #dev-tools-menu button:hover, #dev-tools-menu a:hover {
      background: rgba(201,168,76,0.15);
      color: #c9a84c;
    }

    .dev-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 5px;
      margin-bottom: 4px;
    }
    .dev-grid button {
      text-align: center !important;
      padding: 8px 2px !important;
      font-weight: 700;
    }

    @keyframes devFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.innerHTML = css;
  document.head.appendChild(styleEl);

  window.devJumpToCond = function(cond) {
    const sid = 'dev_' + cond.toLowerCase();
    const mockState = {
      sessionId: sid,
      participantId: 'DEV_USER',
      topic: 'Universal Basic Income',
      condition: cond,
      startedAt: new Date().toISOString()
    };
    localStorage.setItem('debate_session_' + sid, JSON.stringify(mockState));
    
    // Ensure participant state exists
    const ps = JSON.parse(localStorage.getItem('dc_participant_state') || '{}');
    ps.participantId = 'DEV_USER';
    ps.topic = 'Universal Basic Income';
    if (!ps.conditionsDone) ps.conditionsDone = [];
    localStorage.setItem('dc_participant_state', JSON.stringify(ps));

    window.location.href = `/debate.html?s=${sid}`;
  };

  window.devJumpToSurvey = function(step) {
    // Ensure dummy data exists so survey doesn't crash
    const ps = JSON.parse(localStorage.getItem('dc_participant_state') || '{}');
    if (!ps.conditionData) ps.conditionData = {
      A: { messages: [], startedAt: new Date().toISOString() },
      B: { messages: [], startedAt: new Date().toISOString() },
      C: { messages: [], startedAt: new Date().toISOString() }
    };
    ps.participantId = ps.participantId || 'DEV_USER';
    ps.topic = ps.topic || 'Universal Basic Income';
    localStorage.setItem('dc_participant_state', JSON.stringify(ps));

    window.location.href = `/reflect.html?final=1&step=${step}`;
  };

  const container = document.createElement('div');
  container.id = 'dev-tools-container';
  container.innerHTML = `
    <div id="dev-tools-menu">
      <div class="dev-section">
        <div class="dev-header">Main Navigation</div>
        <a href="/">🏠 Home (Topic Select)</a>
        <a href="/admin.html">📊 Researcher Dashboard</a>
      </div>

      <div class="dev-section">
        <div class="dev-header">Jump to Condition</div>
        <div class="dev-grid">
          <button onclick="devJumpToCond('A')">Cond A</button>
          <button onclick="devJumpToCond('B')">Cond B</button>
          <button onclick="devJumpToCond('C')">Cond C</button>
        </div>
      </div>

      <div class="dev-section">
        <div class="dev-header">Jump to Survey Steps</div>
        <button onclick="devJumpToSurvey(1)">Step 1 (Likert Ratings)</button>
        <button onclick="devJumpToSurvey(2)">Step 2 (Open Reflection)</button>
      </div>

      <div class="dev-section">
        <div class="dev-header">System</div>
        <a href="/complete.html">✅ Completion Page</a>
        <button onclick="localStorage.clear(); location.reload();" style="color:#e05c5c; background:rgba(224,92,92,0.1);">🧹 Reset Study (Clear Data)</button>
      </div>
    </div>
    <div id="dev-tools-toggle" title="Developer Tools">🛠️</div>
  `;
  document.body.appendChild(container);

  const toggle = document.getElementById('dev-tools-toggle');
  const menu = document.getElementById('dev-tools-menu');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('visible');
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      menu.classList.remove('visible');
    }
  });

})();
