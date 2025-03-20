// tree_viewer.js

// node_storage
let worker;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Script load error for ${url}`));
    document.head.append(script);
  });
}

window._progressValue = 0;

function setProgressBar(msg) {
  window._progressValue = 0;
  document.body.innerHTML = `<div style='width:50vw;margin: calc(10vh) 25vw;'>${msg}<div id='progress-bar'><div id='progress'></div><div id='progress-info'></div></div></div>`;
}

function updateProgress(progress) {
  if (progress) window._progressValue = progress;
  else window._progressValue = 1 - (1 - window._progressValue) * 0.9;
  document.getElementById('progress-bar').style.cssText = `--progressPct: ${progress*100}%`;
  document.getElementById('progress-info').textContent = Math.round(progress*100) + '%';
}

function initializeWorker() {
  worker = new Worker('static/cache_worker.js');

  worker.onmessage = function(e) {
    const { progress, flattenedTree, error, message } = e.data;

    if (message) {
      setProgressBar(message);
    }

    if (error) {
      console.error(error);
    }

    if (progress !== undefined) {
      updateProgress(progress);
    }

    if (flattenedTree) {
      renderTree(flattenedTree);
    }
  };
}

async function fetchTree(url) {
  worker.postMessage({ action: "fetchTree", url });
}

function renderTree(flattenedTree) {
  document.body.innerHTML = "";
  window.chatTree = flattenedTree;
  window.rootNodeId = Object.keys(flattenedTree)[0];

  const rootUl = document.createElement('ul');
  rootUl.id = 'myUL';

  const rootElement = createNodeElement(flattenedTree[window.rootNodeId]);
  Array.from(rootElement.querySelectorAll("div")).forEach((e) => e.classList.add("is-in-root"));
  rootUl.appendChild(rootElement);

  document.body.appendChild(rootUl);
}

// node_management

const nodeList = {};

function assignId(node) {
  nodeList[node.id] = node;
  return node.id;
}

function getNodeById(id) {
  return nodeList[id];
}

function fetchChildrenFromWorker(nodeId) {
  return new Promise((resolve) => {
    worker.onmessage = function(e) {
      if (e.data.action === 'childrenFetched' && e.data.nodeId === nodeId) {
        resolve(e.data.children);
      }
    };
    worker.postMessage({ action: 'getChildren', nodeId });
  });
}

async function getChildren(node) {
  const children = await fetchChildrenFromWorker(node.id);
  return Object.values(children);
}

  
// tree_renderers
window._SCROLLING_ALLOWED = true;
async function toggleNode(event) {
  const nodeContent = event.currentTarget;
  const nodeElement = event.currentTarget.parentElement;
  const nestedList = nodeElement.querySelector(".nested");

  const nodeId = parseInt(nestedList.getAttribute("id"), 10);
  const nodeData = getNodeById(nodeId);

  if (!nestedList.classList.contains("loaded")) {
    console.debug('Loading children for node ID:', nodeId, 'Node data:', nodeData);
    await renderChildNodes(nodeData, nestedList);
    nestedList.classList.add("loaded");
  } else {
    console.debug('Already Loaded node ID:', nodeId, 'Node data:', nodeData);
  }

  nodeElement.classList.toggle("open");
  nodeContent.classList.toggle("is-visible");
  if (nodeElement.classList.contains("open") && window._SCROLLING_ALLOWED) {
    nestedList.scrollIntoView({ 
      behavior: "smooth", 
      block: "center",
      inline: "center",
    });
  } else {
    nodeElement.querySelectorAll("li.open").forEach(elem => {
      elem.classList.remove("open");
    });
    nodeElement.querySelectorAll(".node.is-visible").forEach(elem => {
      elem.classList.remove("is-visible");
    });
    nodeElement.querySelectorAll(".node-content").forEach(elem => {
      elem.style.top = 0;
    });
  }
  adjustAllNodes();
  centerContentVertically(nodeContent);
}

function createRespDistItem(key, respDist, allCSSVars){
  const perc = (100 * respDist[key]).toFixed(0);
  const valueDiv = document.createElement('div');
  valueDiv.className = `r-d-${key} r-d-elem`;
  valueDiv.style.cssText = `--bar-size: ${perc}; --bar-perc: ${perc}%;`;
  allCSSVars.push(`--${key}-size: ${perc}; --${key}-perc: ${perc}%;`);

  const label = document.createElement('div');
  label.className = 'r-d-label';
  label.textContent = key;
  
  const value = document.createElement('div');
  value.className = 'r-d-value';
  value.textContent = `${perc}%`;
  
  valueDiv.appendChild(label);
  valueDiv.appendChild(value);
  return valueDiv;
}

function renderResponseDistribution(node) {
  if (!node.response_distribution) return null;
  const respDist = node.response_distribution;

  const responseDiv = document.createElement('div');
  responseDiv.className = 'response-distribution';

  const yesnoDiv = document.createElement('div');
  yesnoDiv.className = 'r-d-yesno-container'

  let allCSSVars = []
  const yesDiv = createRespDistItem("yes", respDist, allCSSVars);
  const noDiv = createRespDistItem("no", respDist, allCSSVars);
  const maybeDiv = createRespDistItem("maybe", respDist, allCSSVars);
  yesnoDiv.appendChild(yesDiv);
  yesnoDiv.appendChild(noDiv);
  responseDiv.appendChild(yesnoDiv);
  responseDiv.appendChild(maybeDiv);
  responseDiv.style.cssText = allCSSVars.join("");

  return responseDiv;
}

function createNodeElement(node) {
  assignId(node);
  const li = document.createElement('li');
  li.className = 'caret';
  if (node.next && Object.keys(node.next).length > 0) {
    li.classList.add('has-children');
  }

  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'node';
  nodeDiv.onclick = async (e) => await toggleNode(e); // Using node.onclick

  const nodeContentDiv = document.createElement('div')
  nodeContentDiv.className = 'node-content';
  
  const nodeContentWrapper = document.createElement('div')
  nodeContentWrapper.className = 'node-content-wrapper';

  for (let k of ['value', 'prob', 'total_prob', 'depth']) {
    const newDiv = document.createElement('div');
    newDiv.className = k;
    newDiv.textContent = node[k];
    if (k == 'prob')
      newDiv.textContent = `${(100*node[k]).toFixed(0)}%`;
    if (k == 'value'){
      newDiv.innerHTML = newDiv.innerHTML.replace("&lt;|endoftext|&gt;", "<span class='endoftext'>end</span>");
    }
    nodeContentDiv.appendChild(newDiv);
  }

  nodeContentWrapper.appendChild(nodeContentDiv);
  nodeDiv.appendChild(nodeContentWrapper);

  const nestedUl = document.createElement('ul');
  nestedUl.className = 'nested';
  nestedUl.setAttribute('id', node.id);

  const responseDiv = renderResponseDistribution(node);
  
  li.appendChild(nodeDiv);
  // if (responseDiv) {
  //   nodeDiv.appendChild(responseDiv);
  //   nodeContentWrapper.classList.add("has-response-dist");
  // }
  // if (responseDiv) li.appendChild(responseDiv);
  if (responseDiv) nodeContentDiv.appendChild(responseDiv);
  li.appendChild(nestedUl);

  return li;
}

async function renderChildNodes(node, parentElement) {
  const children = await getChildren(node);
  for (let childNode of children) {
    if ((childNode.prob > window.CUTOFF) || (childNode.value == "<|endoftext|>")) {
      const childElement = createNodeElement(childNode);
      parentElement.appendChild(childElement);
    }
  }
}

function centerContentVertically(node) {
  const content = node.querySelector('.node-content');
  const container = node.querySelector('.node-content-wrapper');
  const parentRange = container.getBoundingClientRect();
  const minY = Math.max(parentRange.y, 0);
  const maxY = Math.max(
      minY,
      Math.min(parentRange.bottom, window.innerHeight) - content.offsetHeight
    );
  const midpointY = (window.innerHeight - content.offsetHeight) / 2;
  const closestMidpointY = Math.min(maxY, Math.max(minY, midpointY));
  const boxMidpiontY = (minY + maxY) / 2;
  const targetY = (closestMidpointY + boxMidpiontY)/2;
  // const targetY = boxMidpiontY;
  content.style.top = Math.min(window.innerHeight-parentRange.y, Math.max(0, targetY - parentRange.y));
}

function adjustAllNodes() {
  const nodes = document.querySelectorAll('.node.is-visible');
  nodes.forEach(node => centerContentVertically(node));
  nodes.forEach(node => centerContentVertically(node));
}

//app.js

function elementIsOnScreen(e) {
  const rect = e.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

async function openEverything() {
  const visibleClosedElements = Array.from(document.querySelectorAll("li.caret"))
    .filter(e => elementIsOnScreen(e))
    .filter(e => !e.classList.contains("open"));

  window._SCROLLING_ALLOWED = false;

  // Open nodes one by one
  for (let el of visibleClosedElements) {
    await new Promise(resolve => {
      setTimeout(() => {
        el.querySelector(".node").click();
        resolve();
      }, 50); 
    });
  }
  await new Promise(resolve => setTimeout(resolve, 100)); 

  const middleElement = visibleClosedElements[Math.floor(visibleClosedElements.length / 2)];
  if (middleElement) {
    await new Promise(resolve => {
      setTimeout(() => {
        middleElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
        resolve();
      }, 100);
    });
  }
}


document.addEventListener('keydown', function(event) {
  if (event.key === '=') {
    openEverything();
  }
});

window.CUTOFF = .09;

window.addEventListener('resize', adjustAllNodes);
window.addEventListener('scroll', adjustAllNodes);
document.addEventListener('DOMContentLoaded', adjustAllNodes);

document.addEventListener("DOMContentLoaded", async () => {
  // await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.0.4/pako.min.js');
  if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
    const warningDiv = document.createElement("div");
    warningDiv.id = "mobile-warning";
    warningDiv.innerHTML = `<div style='position: fixed; top: 20%; left: 0%; right: 0%; height: 50%;   background: #500;color: white;text-align: center;font-size: 3vh;font-family: sans-serif;padding: 1em;'>
      <p>This demo is not mobile-friendly. It uses a lot of data and relies on desktop-only browser features.</p>
      <button id='proceed-button'>Try Anyways</button>
    </div>`;
    document.body.appendChild(warningDiv);

    document.getElementById("proceed-button").addEventListener("click", function() {
      document.body.removeChild(warningDiv);
      initializeWorker();
      fetchTree('/static/tree.json.gz');
    });
    return;
  }
  
  initializeWorker();
  await fetchTree('/static/tree.json.gz');
});
