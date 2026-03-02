/**
 * STEP 文件解析 Web Worker
 * 使用 opencascade.js (XDE) 在独立线程中执行 STEP 解析
 *
 * 功能：
 * - STEPCAFControl_Reader 读取（保留颜色/名称/装配体结构）
 * - TopExp_Explorer 遍历拓扑（Compound → Solid → Face）
 * - BRepAdaptor_Surface 精确识别面类型和几何属性
 * - BRepMesh_IncrementalMesh 三角化
 * - BRep_Tool.Triangulation 提取网格数据
 * - Transferable 零拷贝传输
 */

import type {
  WorkerRequest,
  WorkerResponse,
  SerializedSolidData,
  SerializedTreeNode,
  FaceGroupInfo,
  FaceGeometryData,
  EdgeGroupInfo,
  EdgeGeometryData
} from '../types'

// OpenCascade 实例
let oc: any = null

/**
 * 向主线程发送消息（类型安全）
 */
function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ; (self as unknown as Worker).postMessage(msg, transfer)
  } else {
    self.postMessage(msg)
  }
}

/**
 * 初始化 opencascade.js WASM（Worker 内单例）
 */
async function initOC(): Promise<any> {
  if (oc) return oc

  post({ type: 'progress', stage: '正在加载 OpenCascade WASM 引擎...', percent: 5 })

  try {
    const initOpenCascade = (await import('opencascade.js')).default
    oc = await initOpenCascade()
    return oc
  } catch (error) {
    throw new Error(`OpenCascade WASM 初始化失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * GC 包装器 — 管理 OCCT 对象内存
 */
function withGC<T>(fn: (register: <O>(obj: O) => O) => T): T {
  const toDelete: any[] = []
  const register = <O>(obj: O): O => {
    toDelete.push(obj)
    return obj
  }
  try {
    return fn(register)
  } finally {
    for (const obj of toDelete) {
      try {
        if (obj && typeof obj.delete === 'function') obj.delete()
      } catch { /* ignore */ }
    }
  }
}

/**
 * 读取 STEP 文件，返回合并后的 TopoDS_Shape
 */
function readStepFile(fileBuffer: ArrayBuffer): any {
  return withGC((r) => {
    const fileName = 'model.step'

    // 写入 Emscripten 虚拟文件系统
    oc.FS.createDataFile('/', fileName, new Uint8Array(fileBuffer), true, true, true)

    post({ type: 'progress', stage: '正在读取 STEP 文件...', percent: 15 })

    // 使用 STEPControl_Reader（简单可靠）
    const reader = r(new oc.STEPControl_Reader_1())
    const readResult = reader.ReadFile(fileName)

    // 清理虚拟文件
    try { oc.FS.unlink(`/${fileName}`) } catch { /* ignore */ }

    if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error('STEP 文件读取失败，请检查文件是否损坏')
    }

    post({ type: 'progress', stage: '正在转换模型数据...', percent: 25 })

    // 转换所有根实体
    reader.TransferRoots(r(new oc.Message_ProgressRange_1()))

    // 获取合并后的形状（不注册到 GC，由调用方管理）
    const shape = reader.OneShape()
    return shape
  })
}

/**
 * 提取面的几何信息（使用 BRepAdaptor_Surface）
 */
function extractFaceGeometry(face: any): FaceGeometryData {
  return withGC((r) => {
    const adaptor = r(new oc.BRepAdaptor_Surface_2(face, false))
    const surfType = adaptor.GetType()
    const ga = oc.GeomAbs_SurfaceType

    const result: FaceGeometryData = { type: 'face' }

    try {
      if (surfType === ga.GeomAbs_Plane) {
        result.type = 'plane'
        const plane = adaptor.Plane()
        const loc = plane.Location()
        const dir = plane.Axis().Direction()
        result.center = [loc.X(), loc.Y(), loc.Z()]
        result.normal = [dir.X(), dir.Y(), dir.Z()]
      } else if (surfType === ga.GeomAbs_Cylinder) {
        const cyl = adaptor.Cylinder()
        const ax = cyl.Axis()
        const loc = ax.Location()
        const dir = ax.Direction()
        result.center = [loc.X(), loc.Y(), loc.Z()]
        result.axis = [dir.X(), dir.Y(), dir.Z()]
        result.normal = [dir.X(), dir.Y(), dir.Z()]
        result.radius = cyl.Radius()

        // UV 参数域
        const uMin = adaptor.FirstUParameter()
        const uMax = adaptor.LastUParameter()
        const vMin = adaptor.FirstVParameter()
        const vMax = adaptor.LastVParameter()
        result.uBounds = [uMin, uMax]
        result.vBounds = [vMin, vMax]
        result.startAngle = uMin
        result.endAngle = uMax

        // 计算高度
        if (isFinite(vMin) && isFinite(vMax)) {
          result.height = Math.abs(vMax - vMin)
        }

        // 判断是否是完整圆柱还是圆弧柱
        if (Math.abs(uMax - uMin) < Math.PI * 1.99) {
          result.type = 'arc'
        } else {
          result.type = 'cylinder'
        }
      } else if (surfType === ga.GeomAbs_Cone) {
        result.type = 'cone'
        const cone = adaptor.Cone()
        const apex = cone.Apex()
        const ax = cone.Axis()
        const dir = ax.Direction()
        result.center = [apex.X(), apex.Y(), apex.Z()]
        result.axis = [dir.X(), dir.Y(), dir.Z()]
        result.normal = [dir.X(), dir.Y(), dir.Z()]
        result.semiAngle = cone.SemiAngle()
        result.radius = cone.RefRadius()
      } else if (surfType === ga.GeomAbs_Sphere) {
        result.type = 'sphere'
        const sphere = adaptor.Sphere()
        const center = sphere.Location()
        result.center = [center.X(), center.Y(), center.Z()]
        result.radius = sphere.Radius()
      } else if (surfType === ga.GeomAbs_Torus) {
        result.type = 'torus'
        const torus = adaptor.Torus()
        const center = torus.Location()
        const dir = torus.Axis().Direction()
        result.center = [center.X(), center.Y(), center.Z()]
        result.axis = [dir.X(), dir.Y(), dir.Z()]
        result.normal = [dir.X(), dir.Y(), dir.Z()]
        result.majorRadius = torus.MajorRadius()
        result.minorRadius = torus.MinorRadius()
        result.radius = torus.MajorRadius()
      } else {
        // BezierSurface, BSplineSurface, 等 — 只提取 UV 域
        result.type = 'face'
      }
    } catch {
      // 几何提取失败时用默认值
      result.type = 'face'
    }

    return result
  })
}

/**
 * 提取圆形面检测（对 PLANE 类型面，检查是否为圆形轮廓）
 */
function checkCircularPlaneFace(face: any, positions: Float32Array, startVertex: number, vertexCount: number): FaceGeometryData | null {
  if (vertexCount < 6) return null

  // 计算中心
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < vertexCount; i++) {
    const vi = (startVertex + i) * 3
    cx += positions[vi]
    cy += positions[vi + 1]
    cz += positions[vi + 2]
  }
  cx /= vertexCount
  cy /= vertexCount
  cz /= vertexCount

  // 计算到中心的距离
  let sumDist = 0
  const distances: number[] = []
  for (let i = 0; i < vertexCount; i++) {
    const vi = (startVertex + i) * 3
    const dx = positions[vi] - cx
    const dy = positions[vi + 1] - cy
    const dz = positions[vi + 2] - cz
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    distances.push(d)
    sumDist += d
  }
  const avgDist = sumDist / vertexCount
  if (avgDist < 0.001) return null

  // 10% 容差检查
  const tolerance = avgDist * 0.1
  const isCircular = distances.every(d => Math.abs(d - avgDist) < tolerance)
  if (!isCircular) return null

  return {
    type: 'circle',
    center: [cx, cy, cz],
    radius: avgDist
  }
}

/**
 * 从单个 Face 提取三角化数据
 */
function extractFaceTriangulation(face: any, globalVertexOffset: number): {
  positions: number[]
  normals: number[]
  indices: number[]
  vertexCount: number
} | null {
  return withGC((r) => {
    const location = r(new oc.TopLoc_Location_1())
    const triangulationHandle = oc.BRep_Tool.Triangulation(face, location, 0)

    if (triangulationHandle.IsNull()) return null

    const tri = triangulationHandle.get()
    const transformation = location.Transformation()
    const nbNodes = tri.NbNodes()
    const nbTriangles = tri.NbTriangles()

    if (nbNodes === 0 || nbTriangles === 0) return null

    const positions: number[] = []
    const normals: number[] = []

    // 提取顶点位置
    for (let i = 1; i <= nbNodes; i++) {
      const node = tri.Node(i)
      const p = node.Transformed(transformation)
      positions.push(p.X(), p.Y(), p.Z())
    }

    // 提取法线
    const hasNormals = tri.HasNormals()
    if (hasNormals) {
      for (let i = 1; i <= nbNodes; i++) {
        try {
          const normal = tri.Normal(i)
          normals.push(normal.X(), normal.Y(), normal.Z())
        } catch {
          normals.push(0, 1, 0) // fallback
        }
      }
    } else {
      // 填充零法线，后续在 Three.js 中 computeVertexNormals
      for (let i = 0; i < nbNodes; i++) {
        normals.push(0, 0, 0)
      }
    }

    // 提取三角形索引并处理面朝向
    const orient = face.Orientation_1()
    const isReversed = (orient === oc.TopAbs_Orientation.TopAbs_REVERSED)
    const indices: number[] = []

    for (let i = 1; i <= nbTriangles; i++) {
      const triangle = tri.Triangle(i)
      let n1 = triangle.Value(1)
      let n2 = triangle.Value(2)
      const n3 = triangle.Value(3)

      // 反面翻转绕序
      if (isReversed) {
        const tmp = n1
        n1 = n2
        n2 = tmp
      }

      // OCCT 索引 1-based → 0-based + 全局偏移
      indices.push(
        n1 - 1 + globalVertexOffset,
        n2 - 1 + globalVertexOffset,
        n3 - 1 + globalVertexOffset
      )
    }

    // 如果反面，也翻转法线
    if (isReversed && hasNormals) {
      for (let i = 0; i < normals.length; i++) {
        normals[i] = -normals[i]
      }
    }

    return { positions, normals, indices, vertexCount: nbNodes }
  })
}

/**
 * 提取单条边的几何信息（使用 BRepAdaptor_Curve）
 */
function extractEdgeGeometry(edge: any): EdgeGeometryData {
  return withGC((r) => {
    const adaptor = r(new oc.BRepAdaptor_Curve_2(edge))
    const curveTypeEnum = adaptor.GetType()
    const ga = oc.GeomAbs_CurveType

    let curveType = 'other'
    const result: Partial<EdgeGeometryData> = {}

    try {
      if (curveTypeEnum === ga.GeomAbs_Line) {
        curveType = 'line'
      } else if (curveTypeEnum === ga.GeomAbs_Circle) {
        curveType = 'circle'
        const circ = adaptor.Circle()
        result.radius = circ.Radius()
        const center = circ.Location()
        result.center = [center.X(), center.Y(), center.Z()]
        const dir = circ.Axis().Direction()
        result.axis = [dir.X(), dir.Y(), dir.Z()]
      } else if (curveTypeEnum === ga.GeomAbs_Ellipse) {
        curveType = 'ellipse'
      } else if (curveTypeEnum === ga.GeomAbs_BSplineCurve) {
        curveType = 'bspline'
      } else if (curveTypeEnum === ga.GeomAbs_BezierCurve) {
        curveType = 'bezier'
      }
    } catch { /* ignore */ }

    // 提取起止点
    const uFirst = adaptor.FirstParameter()
    const uLast = adaptor.LastParameter()
    result.startAngle = uFirst
    result.endAngle = uLast

    try {
      const pStart = r(new oc.gp_Pnt_1())
      adaptor.D0(uFirst, pStart)
      result.startPoint = [pStart.X(), pStart.Y(), pStart.Z()]

      const pEnd = r(new oc.gp_Pnt_1())
      adaptor.D0(uLast, pEnd)
      result.endPoint = [pEnd.X(), pEnd.Y(), pEnd.Z()]
    } catch {
      result.startPoint = [0, 0, 0]
      result.endPoint = [0, 0, 0]
    }

    // 计算长度
    let length = 0
    try {
      length = oc.GCPnts_AbscissaPoint.Length_3(adaptor)
    } catch {
      // 回退：用起止点距离估算
      if (result.startPoint && result.endPoint) {
        const dx = result.endPoint[0] - result.startPoint[0]
        const dy = result.endPoint[1] - result.startPoint[1]
        const dz = result.endPoint[2] - result.startPoint[2]
        length = Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
    }
    result.length = length

    return {
      curveType,
      length: result.length || 0,
      startPoint: result.startPoint || [0, 0, 0],
      endPoint: result.endPoint || [0, 0, 0],
      radius: result.radius,
      center: result.center,
      axis: result.axis,
      startAngle: result.startAngle,
      endAngle: result.endAngle
    }
  })
}

/**
 * 离散化单条边为折线点序列
 */
function discretizeEdge(edge: any): number[] {
  return withGC((r) => {
    const adaptor = r(new oc.BRepAdaptor_Curve_2(edge))
    const points: number[] = []

    try {
      // 使用 GCPnts_TangentialDeflection 自适应离散化
      const deflector = r(new oc.GCPnts_TangentialDeflection_2(
        adaptor, 0.1, 0.1, 2, 200, 0.0001
      ))
      const nbPoints = deflector.NbPoints()
      for (let i = 1; i <= nbPoints; i++) {
        const p = deflector.Value(i)
        points.push(p.X(), p.Y(), p.Z())
      }
    } catch {
      // 回退：简单均匀采样
      try {
        const uFirst = adaptor.FirstParameter()
        const uLast = adaptor.LastParameter()
        const nbSamples = 20
        for (let i = 0; i <= nbSamples; i++) {
          const u = uFirst + (uLast - uFirst) * i / nbSamples
          const p = r(new oc.gp_Pnt_1())
          adaptor.D0(u, p)
          points.push(p.X(), p.Y(), p.Z())
        }
      } catch { /* ignore */ }
    }

    return points
  })
}

/**
 * 提取 Solid 中所有拓扑边的数据（去重）
 */
function extractEdgesFromSolid(solidShape: any): {
  edgeGroups: EdgeGroupInfo[]
  edgeGeometries: EdgeGeometryData[]
  edgePolylines: Float32Array
} {
  const edgeGroups: EdgeGroupInfo[] = []
  const edgeGeometries: EdgeGeometryData[] = []
  const allPolylineData: number[] = []

  // 用 IndexedMapOfShape 去重边
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(solidShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap)

  // 构建 edge → 相邻 face 的映射
  const edgeFaceMap = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1()
  oc.TopExp.MapShapesAndAncestors(
    solidShape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    edgeFaceMap
  )

  // 构建 face 索引映射（用于查找相邻面索引）
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(solidShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faceMap)

  const nbEdges = edgeMap.Extent()
  let polylineOffset = 0

  for (let i = 1; i <= nbEdges; i++) {
    try {
      const edge = oc.TopoDS.Edge_1(edgeMap.FindKey(i))

      // 跳过退化边（seam 边等）
      if (oc.BRep_Tool.Degenerated(edge)) continue

      // 提取几何信息
      const geom = extractEdgeGeometry(edge)

      // 离散化为折线
      const polyline = discretizeEdge(edge)
      if (polyline.length < 6) continue // 至少 2 个点

      const edgeIndex = edgeGroups.length
      const polylineCount = polyline.length / 3

      // 查找相邻面
      const adjacentFaceIndices: number[] = []
      try {
        if (edgeFaceMap.Contains(edgeMap.FindKey(i))) {
          const faceList = edgeFaceMap.FindFromKey(edgeMap.FindKey(i))
          const iter = new oc.TopTools_ListIteratorOfListOfShape_2(faceList)
          for (; iter.More(); iter.Next()) {
            const adjFace = iter.Value()
            const faceIdx = faceMap.FindIndex(adjFace)
            if (faceIdx > 0) {
              adjacentFaceIndices.push(faceIdx - 1) // 0-based
            }
          }
          iter.delete()
        }
      } catch { /* ignore */ }

      edgeGroups.push({
        edgeIndex,
        polylineStart: polylineOffset,
        polylineCount,
        adjacentFaceIndices
      })

      edgeGeometries.push(geom)

      for (let j = 0; j < polyline.length; j++) {
        allPolylineData.push(polyline[j])
      }
      polylineOffset += polylineCount
    } catch { /* skip problematic edges */ }
  }

  edgeMap.delete()
  edgeFaceMap.delete()
  faceMap.delete()

  return {
    edgeGroups,
    edgeGeometries,
    edgePolylines: new Float32Array(allPolylineData)
  }
}

/**
 * 统计形状中的 Solid 数量（用于进度报告）
 */
function countSolids(shape: any): number {
  const explorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  let count = 0
  for (; explorer.More(); explorer.Next()) count++
  explorer.delete()
  if (count === 0) {
    const shellExplorer = new oc.TopExp_Explorer_2(
      shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    count = shellExplorer.More() ? 1 : 0
    shellExplorer.delete()
  }
  return Math.max(count, 1)
}

/**
 * 提取单个 Solid 的网格和几何数据
 */
function extractSingleSolid(solidShape: any, solidIndex: number): SerializedSolidData | null {
  const allPositions: number[] = []
  const allNormals: number[] = []
  const allIndices: number[] = []
  const faceGroups: FaceGroupInfo[] = []
  const faceGeometries: FaceGeometryData[] = []

  let globalVertexOffset = 0
  let faceIndex = 0

  // 遍历 Solid 中的所有 Face
  const faceExplorer = new oc.TopExp_Explorer_2(
    solidShape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  for (; faceExplorer.More(); faceExplorer.Next()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current())

    // 提取三角化数据
    const meshData = extractFaceTriangulation(face, globalVertexOffset)
    if (!meshData) {
      faceIndex++
      continue
    }

    const indexStart = allIndices.length

    // 合并数据
    for (let i = 0; i < meshData.positions.length; i++) allPositions.push(meshData.positions[i])
    for (let i = 0; i < meshData.normals.length; i++) allNormals.push(meshData.normals[i])
    for (let i = 0; i < meshData.indices.length; i++) allIndices.push(meshData.indices[i])

    faceGroups.push({
      start: indexStart,
      count: meshData.indices.length,
      faceIndex
    })

    // 提取面的精确几何信息
    let geom = extractFaceGeometry(face)

    // 对 PLANE 类型面额外检测是否为圆形
    if (geom.type === 'plane') {
      const circleCheck = checkCircularPlaneFace(
        face,
        new Float32Array(meshData.positions),
        0,
        meshData.vertexCount
      )
      if (circleCheck) {
        // 保留原始法向信息
        circleCheck.normal = geom.normal
        geom = circleCheck
      }
    }

    faceGeometries.push(geom)

    globalVertexOffset += meshData.vertexCount
    faceIndex++
  }

  faceExplorer.delete()

  if (allPositions.length === 0) return null

  // 提取拓扑边数据
  const edgeData = extractEdgesFromSolid(solidShape)

  return {
    name: `Solid_${solidIndex}`,
    positions: new Float32Array(allPositions),
    normals: new Float32Array(allNormals),
    indices: new Uint32Array(allIndices),
    faceGroups,
    faceGeometries,
    edgeGroups: edgeData.edgeGroups,
    edgeGeometries: edgeData.edgeGeometries,
    edgePolylines: edgeData.edgePolylines
  }
}

// buildTreeData 已移除，改用 parseStepFile 中的统一递归构建

/**
 * 构建单个 Solid 的树节点（含 Edge 子节点）
 */
function buildSolidTreeNode(solidIndex: number, solidData?: SerializedSolidData): SerializedTreeNode | null {
  if (!solidData) return null

  const solidNode: SerializedTreeNode = {
    id: `solid_${solidIndex}`,
    name: solidData.name || `Solid_${solidIndex}`,
    type: 'solid',
    solidIndex,
    children: []
  }

  // 添加 Edge 子节点
  solidData.edgeGeometries.forEach((geom, edgeIdx) => {
    const edgeTypeName = getEdgeDisplayName(geom.curveType)
    solidNode.children!.push({
      id: `solid_${solidIndex}_edge_${edgeIdx}`,
      name: `${edgeTypeName}_${edgeIdx}`,
      type: 'edge',
      solidIndex,
      edgeIndex: edgeIdx
    })
  })

  return solidNode
}

/**
 * 获取边曲线类型显示名称
 */
function getEdgeDisplayName(curveType: string): string {
  const names: Record<string, string> = {
    line: '直线',
    circle: '圆弧',
    ellipse: '椭圆弧',
    bspline: 'B样条曲线',
    bezier: '贝塞尔曲线',
    other: '曲线'
  }
  return names[curveType] || '边'
}

/**
 * 解析 STEP 文件完整流程
 * ★ 统一递归遍历：同步提取网格数据和构建结构树，保证 solidIndex 严格一致
 * 修复旧版分离遍历导致的树 ↔ 模型索引不对应问题
 */
function parseStepFile(fileBuffer: ArrayBuffer): {
  solids: SerializedSolidData[]
  tree: SerializedTreeNode
  transferList: Transferable[]
} {
  // 1. 读取 STEP 文件
  const shape = readStepFile(fileBuffer)

  post({ type: 'progress', stage: '正在三角化模型...', percent: 40 })

  // 2. 三角化整个形状
  withGC((r) => {
    r(new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false))
  })

  post({ type: 'progress', stage: '正在提取网格数据...', percent: 50 })

  // 3. 统一递归提取网格 + 构建树
  const totalSolids = countSolids(shape)
  const solids: SerializedSolidData[] = []
  let solidIndex = 0
  let compoundIndex = 0

  /**
   * 递归处理形状：同时提取 Mesh 和生成 TreeNode
   * ★ solidIndex 仅在 Solid 实际提取成功时才递增，保证 tree.solidIndex === solids[] 数组下标
   */
  function processShape(s: any, depth: number): SerializedTreeNode | null {
    const sType = s.ShapeType()

    // SOLID → 提取网格 + 生成树节点
    if (sType === oc.TopAbs_ShapeEnum.TopAbs_SOLID) {
      const solidData = extractSingleSolid(s, solidIndex)
      if (!solidData) return null
      solids.push(solidData)
      const node = buildSolidTreeNode(solidIndex, solidData)
      solidIndex++
      const pct = 50 + Math.round((solidIndex / Math.max(totalSolids, 1)) * 30)
      post({ type: 'progress', stage: `正在处理实体 ${solidIndex}/${totalSolids}...`, percent: Math.min(pct, 80) })
      return node
    }

    // COMPOUND / COMPSOLID → 递归子形状
    if (sType === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND ||
      sType === oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID) {
      const compId = compoundIndex++
      const children: SerializedTreeNode[] = []
      const iter = new oc.TopoDS_Iterator_2(s, true, true)
      for (; iter.More(); iter.Next()) {
        const childNode = processShape(iter.Value(), depth + 1)
        if (childNode) children.push(childNode)
      }
      iter.delete()
      if (children.length === 0) return null
      // 顶层 Compound 使用 root 类型
      if (depth === 0) {
        return { id: 'root', name: 'Model', type: 'root', children }
      }
      return {
        id: `compound_${compId}`,
        name: `Component_${compId}`,
        type: 'compound',
        children
      }
    }

    // SHELL / FACE 等 → 作为单个 Solid 提取
    if (sType === oc.TopAbs_ShapeEnum.TopAbs_SHELL ||
      sType === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
      const solidData = extractSingleSolid(s, solidIndex)
      if (!solidData) return null
      solids.push(solidData)
      const node = buildSolidTreeNode(solidIndex, solidData)
      solidIndex++
      return node
    }

    return null
  }

  const shapeType = shape.ShapeType()
  let tree: SerializedTreeNode

  if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND ||
    shapeType === oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID) {
    tree = processShape(shape, 0) || { id: 'root', name: 'Model', type: 'root', children: [] }
  } else {
    const childNode = processShape(shape, 1)
    tree = {
      id: 'root',
      name: 'Model',
      type: 'root',
      children: childNode ? [childNode] : []
    }
  }

  post({ type: 'progress', stage: '正在传输数据...', percent: 85 })

  // 4. 收集 Transferable
  const transferList: Transferable[] = []
  for (const solid of solids) {
    transferList.push(solid.positions.buffer)
    transferList.push(solid.normals.buffer)
    transferList.push(solid.indices.buffer)
    if (solid.edgePolylines.byteLength > 0) {
      transferList.push(solid.edgePolylines.buffer)
    }
  }

  // 5. 清理 shape
  try { shape.delete() } catch { /* ignore */ }

  return { solids, tree, transferList }
}

// ============ Comlink API ============

import * as Comlink from 'comlink'

/** 进度回调类型 */
export type ProgressCallback = (stage: string, percent: number) => void

/**
 * Worker 暴露的 API（通过 Comlink 调用）
 */
const workerApi = {
  /**
   * 初始化 OpenCascade WASM
   */
  async init(): Promise<void> {
    await initOC()
  },

  /**
   * 解析 STEP 文件
   * @param fileBuffer STEP 文件二进制数据
   * @param onProgress 进度回调（通过 Comlink.proxy 传递）
   */
  async parse(
    fileBuffer: ArrayBuffer,
    onProgress?: ProgressCallback
  ): Promise<{ solids: SerializedSolidData[]; tree: SerializedTreeNode }> {
    // 覆盖 post 函数以使用 Comlink 进度回调
    const origPost = (self as any).__origPost
    if (onProgress) {
      // 劫持 post 以转发 progress 事件到 Comlink 回调
      ; (self as any).__progressCb = onProgress
    }

    await initOC()

    // 解析 STEP 文件
    const { solids, tree } = parseStepFile(fileBuffer)

      ; (self as any).__progressCb = null
    return { solids, tree }
  }
}

// 劫持 post 函数，使 progress 事件可通过 Comlink 回调转发
const origPost = post
  ; (self as any).__origPost = origPost

// 重写 post 以支持 Comlink 模式
function postHook(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (msg.type === 'progress' && (self as any).__progressCb) {
    try {
      ; (self as any).__progressCb(msg.stage, msg.percent)
    } catch { /* ignore callback errors */ }
  }
  // 仍然发送原始 postMessage 以保持兼容性
  origPost(msg, transfer)
}

// 替换全局 post
; (post as any) = postHook

export type StepParseWorkerApi = typeof workerApi

Comlink.expose(workerApi)

// ============ 传统 postMessage API（保持向后兼容） ============

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  // 如果消息由 Comlink 处理，则跳过
  if (event.data && typeof event.data === 'object' && !('type' in event.data)) return

  const request = event.data

  try {
    switch (request.type) {
      case 'init': {
        await initOC()
        origPost({ type: 'ready' })
        break
      }

      case 'parse': {
        await initOC()
        const { solids, tree, transferList } = parseStepFile(request.fileBuffer)
        origPost({ type: 'progress', stage: '传输数据中...', percent: 95 })
        origPost(
          { type: 'result', solids, tree, success: true },
          transferList
        )
        break
      }
    }
  } catch (error) {
    origPost({
      type: 'error',
      message: error instanceof Error ? error.message : '未知解析错误'
    })
  }
}

// 通知主线程 Worker 已加载
origPost({ type: 'progress', stage: 'Worker 已就绪', percent: 0 })
