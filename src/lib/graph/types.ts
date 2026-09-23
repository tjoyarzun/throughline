/**
 * The graph engine's contract.
 *
 * Everything that traverses goes through this interface, so swapping
 * PostgresGraphEngine for a Neo4j or AGE implementation is a single-file
 * change. The trigger conditions for actually doing that are written down in
 * docs/adr/0003: p95 findPaths above 250ms, more than 5M edges, or a feature
 * that genuinely needs unbounded variable-length pattern matching.
 */

export interface NodeRef {
  type: string;
  id: string;
}

export interface GraphNode extends NodeRef {
  slug: string;
  label: string;
  sublabel: string | null;
  imagePath: string | null;
  degree: number;
}

/** One traversal step: how you got from the previous node to this one. */
export interface PathStep {
  predicate: string;
  /**
   * The predicate as declared in the ontology. An inverse step carries a
   * predicate name (directed_by) that does not exist in the ontology, so the
   * canonical one is what narration and weights must be looked up by.
   */
  canonical: string;
  /** True when this step traversed the edge backwards. Selects the template. */
  isInverse: boolean;
  /** Human-readable label, used only when no template exists. */
  predicateLabel: string;
  node: GraphNode;
}

export interface GraphPath {
  from: GraphNode;
  steps: PathStep[];
  cost: number;
  /** Rarity of the predicates and intermediates; drives ordering among ties. */
  interestingness: number;
  /** Composed left to right from ontology templates. No model involved. */
  narration: string;
}

/** Neighbors of one node, grouped by the relationship that links them. */
export interface NeighborGroup {
  predicate: string;
  label: string;
  nodes: GraphNode[];
  /** How many exist beyond those returned. */
  more: number;
}

/** An edge between two nodes in a neighborhood, for drawing. */
export interface GraphEdge {
  /** `${type}:${id}` on both ends, so a renderer can index without re-deriving. */
  source: string;
  target: string;
  predicate: string;
  label: string;
  /** Ontology path weight. Lower means a stronger, more specific relationship. */
  weight: number;
}

/**
 * A node, the nodes around it, and every edge among the whole set.
 *
 * Distinct from neighbors(), which returns a STAR grouped by predicate and is
 * what the lists render. A star is also literally all a single hop gives you
 * here: a title's neighbors are people, concepts and studios, and this
 * ontology has no direct person-to-person or person-to-concept edge, so the
 * count of edges among one node's neighbors is exactly zero. Measured, not
 * assumed. Two hops is what produces a graph with structure in it -- two
 * actors joined by another film they were both in.
 */
export interface Neighborhood {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphEngine {
  node(ref: NodeRef): Promise<GraphNode | null>;
  neighbors(ref: NodeRef, opts?: { perGroup?: number; groups?: number }): Promise<NeighborGroup[]>;
  findPaths(a: NodeRef, b: NodeRef, opts?: { limit?: number }): Promise<GraphPath[]>;
}
