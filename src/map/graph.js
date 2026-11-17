// Graph helpers for the node/lane map. Nodes are indexed 0..n-1 and the
// adjacency list is an array of arrays of neighbour indices.

export function buildAdjacency(nodeCount, lanes) {
  const adj = Array.from({ length: nodeCount }, () => []);
  for (const { a, b } of lanes) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

/** Jump distances from `start` to every node (Infinity if unreachable). */
export function bfs(adj, start) {
  const dist = new Array(adj.length).fill(Infinity);
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    for (const v of adj[u]) {
      if (dist[v] === Infinity) {
        dist[v] = dist[u] + 1;
        queue.push(v);
      }
    }
  }
  return dist;
}

/** All-pairs jump distances (fine for maps of a few dozen nodes). */
export function allPairs(adj) {
  return adj.map((_, i) => bfs(adj, i));
}

/** Component label per node. */
export function components(adj) {
  const comp = new Array(adj.length).fill(-1);
  let label = 0;
  for (let s = 0; s < adj.length; s++) {
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = label;
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) {
        if (comp[v] === -1) {
          comp[v] = label;
          stack.push(v);
        }
      }
    }
    label++;
  }
  return { comp, count: label };
}

/**
 * Brandes betweenness centrality, normalised to the fraction of all
 * ordered shortest-path pairs (s≠t≠v) that pass through each node.
 */
export function betweenness(adj) {
  const n = adj.length;
  const cb = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const stack = [];
    const preds = Array.from({ length: n }, () => []);
    const sigma = new Array(n).fill(0);
    const dist = new Array(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      stack.push(v);
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }
    const delta = new Array(n).fill(0);
    while (stack.length) {
      const w = stack.pop();
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) cb[w] += delta[w];
    }
  }
  const norm = n > 2 ? (n - 1) * (n - 2) : 1;
  return cb.map((x) => x / norm);
}

/** One shortest path (list of node indices) from a to b, or null. */
export function shortestPath(adj, a, b) {
  const prev = new Array(adj.length).fill(-1);
  const seen = new Array(adj.length).fill(false);
  seen[a] = true;
  const queue = [a];
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    if (u === b) break;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = true;
        prev[v] = u;
        queue.push(v);
      }
    }
  }
  if (!seen[b]) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev[path[0]]);
  return path;
}

/**
 * Movement-cost distances from `start`: entering node v costs cost[v]
 * (Infinity = impassable). Small graphs, so a simple O(n²) Dijkstra.
 */
export function dijkstra(adj, cost, start) {
  const n = adj.length;
  const dist = new Array(n).fill(Infinity);
  const done = new Array(n).fill(false);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const v of adj[u]) {
      const d = dist[u] + cost[v];
      if (d < dist[v]) dist[v] = d;
    }
  }
  return dist;
}
