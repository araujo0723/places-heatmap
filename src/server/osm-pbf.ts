import { createReadStream, type Stats } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { OSMTransform, type OSMOptions } from "osm-pbf-parser-node";
import { boundsIntersect, type GeoBounds } from "../core/geo";

export interface LocalOsmRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}

type RecordKind = "parks" | "waters";

interface OsmMember {
  type?: unknown;
  ref?: unknown;
}

interface OsmEntity {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  refs?: unknown;
  members?: unknown;
  tags?: unknown;
}

interface Candidate {
  id: number;
  name?: string;
  parks: boolean;
  waters: boolean;
}

interface CandidateWay extends Candidate {
  refs: number[];
}

type CandidateRelation = Candidate;

interface NormalizedMember {
  type: "node" | "way" | "relation";
  ref: number;
}

interface SourceFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface LocalOsmIndex {
  version: 1;
  source: SourceFingerprint;
  parks: LocalOsmRecord[];
  waters: LocalOsmRecord[];
}

const INDEX_VERSION = 1;
const INDEX_DIRECTORY = resolve(process.cwd(), ".cache", "osm");
const WATER_TYPES = new Set([
  "lake",
  "pond",
  "reservoir",
  "basin",
  "lagoon",
  "oxbow",
  "cenote",
  "stream_pool",
  "reflecting_pool",
  "moat",
  "fishpond",
]);
const TAG_KEYS = ["name", "leisure", "natural", "water", "landuse"];
const indexPromises = new Map<string, Promise<LocalOsmIndex>>();

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tagsOf(entity: OsmEntity): Record<string, unknown> {
  return entity.tags && typeof entity.tags === "object"
    ? (entity.tags as Record<string, unknown>)
    : {};
}

function candidateFor(entity: OsmEntity): Candidate | undefined {
  if (!finiteNumber(entity.id)) return undefined;
  const tags = tagsOf(entity);
  const parks = tags.leisure === "park";
  const waters =
    (tags.natural === "water" &&
      (tags.water === undefined ||
        (typeof tags.water === "string" && WATER_TYPES.has(tags.water)))) ||
    tags.landuse === "reservoir" ||
    tags.landuse === "salt_pond";
  if (!parks && !waters) return undefined;
  const rawName = tags.name;
  const name =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim()
      : undefined;
  return {
    id: entity.id,
    ...(name ? { name } : {}),
    parks,
    waters,
  };
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(finiteNumber)
    : [];
}

function normalizedMembers(value: unknown): NormalizedMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawMember): NormalizedMember[] => {
    if (!rawMember || typeof rawMember !== "object") return [];
    const member = rawMember as OsmMember;
    const type = String(member.type);
    if (
      !finiteNumber(member.ref) ||
      !["node", "way", "relation"].includes(type)
    ) {
      return [];
    }
    return [
      {
        type: type as NormalizedMember["type"],
        ref: member.ref,
      },
    ];
  });
}

async function scanPbf(
  pbfPath: string,
  options: OSMOptions,
  visit: (entity: OsmEntity) => void,
) {
  const sink = new Writable({
    objectMode: true,
    write(items: unknown, _encoding, callback) {
      try {
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && typeof item === "object") {
              visit(item as OsmEntity);
            }
          }
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  await pipeline(
    createReadStream(pbfPath),
    new OSMTransform(options),
    sink,
  );
}

function entityBounds(
  refs: number[],
  nodeCoordinates: Map<number, [number, number]>,
): GeoBounds | undefined {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ref of refs) {
    const coordinate = nodeCoordinates.get(ref);
    if (!coordinate) continue;
    west = Math.min(west, coordinate[0]);
    south = Math.min(south, coordinate[1]);
    east = Math.max(east, coordinate[0]);
    north = Math.max(north, coordinate[1]);
  }
  return Number.isFinite(west)
    ? { west, south, east, north }
    : undefined;
}

function mergeBounds(
  current: GeoBounds | undefined,
  addition: GeoBounds | undefined,
) {
  if (!addition) return current;
  if (!current) return { ...addition };
  return {
    west: Math.min(current.west, addition.west),
    south: Math.min(current.south, addition.south),
    east: Math.max(current.east, addition.east),
    north: Math.max(current.north, addition.north),
  };
}

function recordFromBounds(
  type: "way" | "relation",
  candidate: Candidate,
  bounds: GeoBounds | undefined,
): LocalOsmRecord | undefined {
  if (!bounds) return undefined;
  return {
    id: `${type}/${candidate.id}`,
    ...(candidate.name ? { name: candidate.name } : {}),
    center: [
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
    ],
    bbox: bounds,
  };
}

function addCandidateRecord(
  candidate: Candidate,
  record: LocalOsmRecord | undefined,
  parks: LocalOsmRecord[],
  waters: LocalOsmRecord[],
) {
  if (!record) return;
  if (candidate.parks) parks.push(record);
  if (candidate.waters) waters.push(record);
}

function collectRelationClosure(
  candidates: CandidateRelation[],
  relations: Map<number, NormalizedMember[]>,
) {
  const relationIds = new Set(candidates.map((candidate) => candidate.id));
  const queue = [...relationIds];
  for (let index = 0; index < queue.length; index += 1) {
    for (const member of relations.get(queue[index]) ?? []) {
      if (member.type === "relation" && !relationIds.has(member.ref)) {
        relationIds.add(member.ref);
        queue.push(member.ref);
      }
    }
  }
  return relationIds;
}

async function buildIndex(
  pbfPath: string,
  source: SourceFingerprint,
): Promise<LocalOsmIndex> {
  const parks: LocalOsmRecord[] = [];
  const waters: LocalOsmRecord[] = [];
  const candidateWays: CandidateWay[] = [];
  const candidateRelations: CandidateRelation[] = [];
  const relations = new Map<number, NormalizedMember[]>();
  const parserOptions: OSMOptions = {
    withInfo: false,
    withTags: {
      node: TAG_KEYS,
      way: TAG_KEYS,
      relation: TAG_KEYS,
    },
  };

  await scanPbf(pbfPath, parserOptions, (entity) => {
    if (entity.type === "relation" && finiteNumber(entity.id)) {
      const members = normalizedMembers(entity.members);
      relations.set(entity.id, members);
      const candidate = candidateFor(entity);
      if (candidate) {
        candidateRelations.push(candidate);
      }
      return;
    }

    const candidate = candidateFor(entity);
    if (!candidate) return;
    if (
      entity.type === "node" &&
      finiteNumber(entity.lon) &&
      finiteNumber(entity.lat)
    ) {
      addCandidateRecord(
        candidate,
        {
          id: `node/${candidate.id}`,
          ...(candidate.name ? { name: candidate.name } : {}),
          center: [entity.lon, entity.lat],
        },
        parks,
        waters,
      );
    } else if (entity.type === "way") {
      candidateWays.push({
        ...candidate,
        refs: numberArray(entity.refs),
      });
    }
  });

  const relationIds = collectRelationClosure(candidateRelations, relations);
  const relationWayIds = new Set<number>();
  const requiredNodeIds = new Set<number>();
  for (const way of candidateWays) {
    for (const ref of way.refs) requiredNodeIds.add(ref);
  }
  for (const relationId of relationIds) {
    for (const member of relations.get(relationId) ?? []) {
      if (member.type === "node") requiredNodeIds.add(member.ref);
      if (member.type === "way") relationWayIds.add(member.ref);
    }
  }

  const nodeCoordinates = new Map<number, [number, number]>();
  const relationWays = new Map<number, number[]>();
  const relationNodeIds = new Set<number>();
  await scanPbf(
    pbfPath,
    { withInfo: false, withTags: false },
    (entity) => {
      if (
        entity.type === "node" &&
        finiteNumber(entity.id) &&
        requiredNodeIds.has(entity.id) &&
        finiteNumber(entity.lon) &&
        finiteNumber(entity.lat)
      ) {
        nodeCoordinates.set(entity.id, [entity.lon, entity.lat]);
      } else if (
        entity.type === "way" &&
        finiteNumber(entity.id) &&
        relationWayIds.has(entity.id)
      ) {
        const refs = numberArray(entity.refs);
        relationWays.set(entity.id, refs);
        for (const ref of refs) {
          if (!nodeCoordinates.has(ref)) relationNodeIds.add(ref);
        }
      }
    },
  );

  if (relationNodeIds.size > 0) {
    await scanPbf(
      pbfPath,
      { withInfo: false, withTags: false },
      (entity) => {
        if (
          entity.type === "node" &&
          finiteNumber(entity.id) &&
          relationNodeIds.has(entity.id) &&
          finiteNumber(entity.lon) &&
          finiteNumber(entity.lat)
        ) {
          nodeCoordinates.set(entity.id, [entity.lon, entity.lat]);
        }
      },
    );
  }

  const wayBounds = new Map<number, GeoBounds>();
  for (const way of candidateWays) {
    const bounds = entityBounds(way.refs, nodeCoordinates);
    if (bounds) wayBounds.set(way.id, bounds);
    addCandidateRecord(
      way,
      recordFromBounds("way", way, bounds),
      parks,
      waters,
    );
  }
  for (const [id, refs] of relationWays) {
    const bounds = entityBounds(refs, nodeCoordinates);
    if (bounds) wayBounds.set(id, bounds);
  }

  const relationBounds = new Map<number, GeoBounds>();
  const resolving = new Set<number>();
  const resolveRelationBounds = (id: number): GeoBounds | undefined => {
    const existing = relationBounds.get(id);
    if (existing) return existing;
    if (resolving.has(id)) return undefined;
    resolving.add(id);
    let bounds: GeoBounds | undefined;
    for (const member of relations.get(id) ?? []) {
      if (member.type === "node") {
        const coordinate = nodeCoordinates.get(member.ref);
        bounds = mergeBounds(
          bounds,
          coordinate
            ? {
                west: coordinate[0],
                south: coordinate[1],
                east: coordinate[0],
                north: coordinate[1],
              }
            : undefined,
        );
      } else if (member.type === "way") {
        bounds = mergeBounds(bounds, wayBounds.get(member.ref));
      } else {
        bounds = mergeBounds(bounds, resolveRelationBounds(member.ref));
      }
    }
    resolving.delete(id);
    if (bounds) relationBounds.set(id, bounds);
    return bounds;
  };

  for (const relation of candidateRelations) {
    addCandidateRecord(
      relation,
      recordFromBounds(
        "relation",
        relation,
        resolveRelationBounds(relation.id),
      ),
      parks,
      waters,
    );
  }

  return {
    version: INDEX_VERSION,
    source,
    parks,
    waters,
  };
}

function sourceFingerprint(path: string, stats: Stats) {
  return {
    path,
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
  };
}

function matchingSource(
  first: SourceFingerprint,
  second: SourceFingerprint,
) {
  return (
    first.path === second.path &&
    first.size === second.size &&
    Math.trunc(first.mtimeMs) === Math.trunc(second.mtimeMs)
  );
}

async function readCachedIndex(
  indexPath: string,
  source: SourceFingerprint,
) {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as LocalOsmIndex;
    return parsed.version === INDEX_VERSION &&
      matchingSource(parsed.source, source) &&
      Array.isArray(parsed.parks) &&
      Array.isArray(parsed.waters)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function configuredPbfPath(explicitPath?: string) {
  const viteEnvironment = (
    import.meta as ImportMeta & { env?: ImportMetaEnv }
  ).env;
  return resolve(
    explicitPath ??
      process.env.OSM_PBF_PATH ??
      viteEnvironment?.OSM_PBF_PATH ??
      "georgia-latest.osm.pbf",
  );
}

function configuredIndexPath(pbfPath: string) {
  const viteEnvironment = (
    import.meta as ImportMeta & { env?: ImportMetaEnv }
  ).env;
  const configured =
    process.env.OSM_INDEX_PATH ?? viteEnvironment?.OSM_INDEX_PATH;
  return configured
    ? resolve(configured)
    : resolve(
        INDEX_DIRECTORY,
        `${basename(pbfPath)}.places-heatmap-v${INDEX_VERSION}.json`,
      );
}

async function loadOrBuildIndex(pbfPath: string): Promise<LocalOsmIndex> {
  let stats: Stats;
  try {
    stats = await stat(pbfPath);
  } catch {
    throw new Error(
      `Local OpenStreetMap PBF not found at ${pbfPath}. Set OSM_PBF_PATH to the extract path.`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(`Local OpenStreetMap PBF path is not a file: ${pbfPath}.`);
  }
  const source = sourceFingerprint(pbfPath, stats);
  const indexPath = configuredIndexPath(pbfPath);
  const cached = await readCachedIndex(indexPath, source);
  if (cached) return cached;

  console.info(`Building local OSM index from ${pbfPath}...`);
  const index = await buildIndex(pbfPath, source);
  await mkdir(dirname(indexPath), { recursive: true });
  const temporaryPath = `${indexPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(index));
    await rename(temporaryPath, indexPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  console.info(
    `Local OSM index contains ${index.parks.length} parks and ${index.waters.length} water features.`,
  );
  return index;
}

export function getLocalOsmIndex(explicitPath?: string) {
  const pbfPath = configuredPbfPath(explicitPath);
  let promise = indexPromises.get(pbfPath);
  if (!promise) {
    promise = loadOrBuildIndex(pbfPath);
    indexPromises.set(pbfPath, promise);
    promise.catch(() => indexPromises.delete(pbfPath));
  }
  return promise;
}

function recordBounds(record: LocalOsmRecord): GeoBounds {
  return (
    record.bbox ?? {
      west: record.center[0],
      south: record.center[1],
      east: record.center[0],
      north: record.center[1],
    }
  );
}

export function queryLocalOsmIndex(
  index: LocalOsmIndex,
  kind: RecordKind,
  bounds: GeoBounds,
) {
  return index[kind].filter((record) =>
    boundsIntersect(recordBounds(record), bounds),
  );
}

export async function queryLocalOsm(
  kind: "parks",
  bounds: GeoBounds,
  explicitPath?: string,
): Promise<LocalOsmRecord[]>;
export async function queryLocalOsm(
  kind: "waters",
  bounds: GeoBounds,
  explicitPath?: string,
): Promise<LocalOsmRecord[]>;
export async function queryLocalOsm(
  kind: RecordKind,
  bounds: GeoBounds,
  explicitPath?: string,
) {
  return queryLocalOsmIndex(
    await getLocalOsmIndex(explicitPath),
    kind,
    bounds,
  );
}

export function clearLocalOsmIndexCache() {
  indexPromises.clear();
}
