//cache_worker.js
const _CUTOFF = .09;
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/1.0.11/pako.min.js');
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('treeDatabase', 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      db.createObjectStore('treeStore');
    };
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    request.onerror = event => {
      reject('Error opening database');
    };
  });
}

async function saveToIndexedDB(db, key, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('treeStore', 'readwrite');
    const store = transaction.objectStore('treeStore');
    const request = store.put(data, key);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject('Error saving data');
    };
  });
}

async function getFromIndexedDB(db, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('treeStore', 'readonly');
    const store = transaction.objectStore('treeStore');
    const request = store.get(key);
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    request.onerror = event => {
      reject('Error fetching data');
    };
  });
}

async function fetchAndCacheData(url) {
  const db = await openDatabase();
  const cachedData = await getFromIndexedDB(db, url);
  if (cachedData) {
    return cachedData;
  }
  self.postMessage({
    message:  "Downloading data (this might take a minute, but it "
      + "should only happen the first time you visit)..."
  })
  const response = await fetch(url);
  const reader = response.body.getReader();
  const contentLength = +response.headers.get('Content-Length');
  let receivedLength = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    const progress = (receivedLength / contentLength);
    self.postMessage({ progress });
  }

  const compressedData = new Uint8Array(receivedLength);
  let position = 0;
  for (let chunk of chunks) {
    compressedData.set(chunk, position);
    position += chunk.length;
  }
  await saveToIndexedDB(db, url, compressedData);
  return compressedData;
}

function assignIds(root) {
  let _cur_id = 0;
  function _setNodeId(node) {
    // fix a compression idea that's no longer in use... TODO: remove
    if (node.v){
      for (let key of ['response_distribution', 'value', 'prob', 'total_prob', 'next']) {
        node[key] = node[key[0]];
        delete node[key];
      }
    }
    node.id = _cur_id++;
    for (let key in node.next) {
      const childNode = node.next[key];
      _setNodeId(childNode);
    }
  }
  _setNodeId(root);
  return _cur_id;
}

function mergeSingleChildNodes(node) {
  let children = getChildren(node);
  while (node.next && children.length === 1) {
    const childNode = children[0];
    node.value += childNode.value;
    node.next = childNode.next;
    node.prob = node.prob;
    children = getChildren(node);
  }
  if (node.next) {
    for (let key in node.next) {
      mergeSingleChildNodes(node.next[key]);
    }
  }
}

function lazySingleChildMerge(node) {
  let children = getChildren(node);
  while (node.next && children.length === 1) {
    const childNode = children[0];
    node.value += childNode.value;
    node.next = childNode.next;
    node.prob = node.prob;
    children = lazySingleChildMerge(node);
  }
  return node;
}

function getChildren(node) {
  let children = [];
  for (let key in node.next) {
    const childNode = flattenedTree[node.next[key]];
    if (childNode.prob > _CUTOFF)
      children.push(childNode);
  }
  return children;
}

function preprocessResponseDistribution(responseDistribution) {
  const rd = {
    yes: (responseDistribution.yes || 0),
    no: (responseDistribution.no || 0),
    maybe: (responseDistribution.maybe || 0),
  };
  if (rd.yes + rd.no == 0) return rd;
  const remainder = 1 - rd.yes - rd.no - rd.maybe;
  return {
    yes: rd.yes + remainder * rd.yes / (rd.yes + rd.no),
    no: rd.no + remainder * rd.no / (rd.yes + rd.no),
    maybe: rd.maybe,
  };
}

function propagateResponseDistributions(node, currentProgress) {
  if (!node.next) return;
  let totalProb = 0;
  let weightedYes = 0;
  let weightedNo = 0;
  let weightedMaybe = 0;
  if (currentProgress?.total !== undefined && currentProgress?.n !== undefined){
    if (currentProgress.n++ % 100 == 0) {
      self.postMessage({ progress: currentProgress.n / currentProgress.total });
    }
  }
  for (let key in node.next) {
    const childNode = node.next[key];
    propagateResponseDistributions(childNode, currentProgress);

    if (childNode.response_distribution) {
      const childProb = childNode.prob;
      const respDist = preprocessResponseDistribution(childNode.response_distribution, currentProgress.nodeCount, currentProgress);
      totalProb += childProb;
      weightedYes += respDist.yes * childProb;
      weightedNo += respDist.no * childProb;
      weightedMaybe += respDist.maybe * childProb;
    }
  }
  if (totalProb > 0) {
    node.response_distribution = {
      yes: weightedYes / totalProb,
      no: weightedNo / totalProb,
      maybe: weightedMaybe / totalProb
    };
  }
}

function flattenTree(node, flattenedNodes = {}) {
  flattenedNodes[node.id] = { ...node };
  if (node.next) {
    flattenedNodes[node.id].next = {};
    for (let key in node.next) {
      const childNode = node.next[key];
      flattenedNodes[node.id].next[key] = childNode.id;
      flattenTree(childNode, flattenedNodes);
    }
  }
  return flattenedNodes;
}

let flattenedTree;
self.onmessage = async function(e) {
  const {url, action, nodeId} = e.data;

  if (action === 'fetchTree'){
    const rawData = await fetchAndCacheData(url);
    self.postMessage({ message: "(1/3) loading data..." });
    class ProgressInflate extends pako.Inflate {
      constructor(options) {
        super(options);
        this.totalLength = rawData.length;
        this.processedLength = 0;
      }
      push(data, flush_mode) {
        this.processedLength += data.length;
        return super.push(data, flush_mode);
      }
    }
    const inflator = new ProgressInflate({ to: 'string' });
    const chunkSize = 1024 * 1024; // 1MB chunks
    for (let i = 0; i < rawData.length; i += chunkSize) {
      const chunk = rawData.subarray(i, i + chunkSize);
      const isLastChunk = i + chunkSize >= rawData.length;
      inflator.push(chunk, isLastChunk);
      const progress = inflator.processedLength / inflator.totalLength;
      self.postMessage({ progress });
      if (inflator.err) {
        self.postMessage({ error: inflator.err });
        return;
      }
    }
    const decompressedData = inflator.result;
    self.postMessage({message: "(2/3) computing node tree..."})
    self.postMessage({ progress: .45 });
    const tree = JSON.parse(decompressedData);
    self.postMessage({ progress: 1 });
    const nodeCount = assignIds(tree);
    self.postMessage({message: "(3/3) computing response distributions..."})
    //mergeSingleChildNodes(tree);
    propagateResponseDistributions(tree, {total:nodeCount, n:0, nodeCount});
    flattenedTree = flattenTree(tree); // Assign to the global flattenedTree
    self.postMessage({ flattenedTree });
  } else if (action === 'getChildren') {
    if (!flattenedTree) {
      self.postMessage({ error: "Tree not loaded yet. Please fetch the tree first." })
      return;
    }
    let node = flattenedTree[nodeId];
    if (!node) {
      self.postMessage({ error: `Node with id ${nodeId} not found.` });
      return;
    }
    const children = {};
    for (let key in node.next) {
      const childNodeId = node.next[key];
      const childNode = lazySingleChildMerge(flattenedTree[childNodeId])
      if (childNode && childNode.prob > _CUTOFF) {
        children[key] = childNode;
      }
    }
    self.postMessage({ action: 'childrenFetched', nodeId, node, children });
  }
};