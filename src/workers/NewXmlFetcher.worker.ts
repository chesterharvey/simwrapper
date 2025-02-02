import pako from 'pako'
import { parseXML } from '@/js/util'

import globalStore from '@/store'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import { FileSystemConfig } from '@/Globals'

onmessage = async function (e) {
  const id = e.data.id
  const xml = await fetchXML(e.data.fileApi, e.data.filePath, e.data.options)

  postMessage({ xml, id })
}

const state = globalStore.state

function getFileSystem(name: string) {
  const svnProject: FileSystemConfig[] = state.svnProjects.filter(
    (a: FileSystemConfig) => a.slug === name
  )
  if (svnProject.length === 0) {
    console.log('no such project:', name)
    throwError('no such project' + name)
  }
  return svnProject[0]
}

async function fetchXML(fileApi: string, filePath: string, options: any) {
  const fileSystem = getFileSystem(fileApi)
  const httpFileSystem = new HTTPFileSystem(fileSystem)

  const blob = await httpFileSystem.getFileBlob(filePath)
  if (!blob) throwError('BLOB IS NULL')

  const data = await getDataFromBlob(blob)

  const xml = parseXML(data, options)

  return xml
}

async function getDataFromBlob(blob: Blob) {
  const data = await blob.arrayBuffer()
  const cargo = gUnzip(data)

  const text = new TextDecoder('utf-8').decode(cargo)
  return text
}

/**
 * This recursive function gunzips the buffer. It is recursive because
 * some combinations of subversion, nginx, and various user browsers
 * can single- or double-gzip .gz files on the wire. It's insane but true.
 */
function gUnzip(buffer: any): any {
  // GZIP always starts with a magic number, hex 1f8b
  const header = new Uint8Array(buffer.slice(0, 2))
  if (header[0] === 31 && header[1] === 139) {
    return gUnzip(pako.inflate(buffer))
  }

  return buffer
}

function throwError(message: string) {
  postMessage({ error: message })
  close()
}

// // make the typescript compiler happy on import
// export default null as any
