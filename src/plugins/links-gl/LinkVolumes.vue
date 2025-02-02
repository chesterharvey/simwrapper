<template lang="pug">
.link-volume-plot(:class="{'hide-thumbnail': !thumbnail}"
        :style='{"background": urlThumbnail}'
        oncontextmenu="return false")

  .plot-container(v-if="!thumbnail")
    link-gl-layer.map-area(
        :base="csvBase"
        :baseData="baseData"
        :build="csvData"
        :buildData="buildData"
        :colors="selectedColorRamp"
        :dark="isDarkMode"
        :geojson="geojsonData"
        :scaleWidth="scaleWidth"
        :showDiffs="showDiffs"
        :viewId="linkLayerId"
    )

    zoom-buttons(v-if="!thumbnail")
    drawing-tool(v-if="!thumbnail")

    .top-panel(v-if="vizDetails.title")
      .panel-item
        h3 {{ vizDetails.title }}
        p {{ vizDetails.description }}

    .bottom-panel(v-if="!thumbnail")
      .status-message(v-if="myState.statusMessage")
        p {{ myState.statusMessage }}

      .panel-items
          //- button/dropdown for selecting column
          .panel-item.config-section
            config-panel(
              :header="csvData.header"
              :activeColumn="csvData.activeColumn"
              :scaleWidth="scaleWidth"
              :selectedColorRamp="selectedColorRamp"
              :csvData="csvData"
              :useSlider="vizDetails.useSlider"
              :showDiffs="showDiffs"
              @colors="clickedColorRamp"
              @column="handleNewDataColumn"
              @slider="handleNewDataColumn"
              @scale="handleScaleWidthChanged"
            )

          //- DIFF checkbox
          .panel-item.diff-section(v-if="csvBase.header.length")
            p: b {{ $t('showDiffs') }}
            toggle-button.toggle(:width="40" :value="showDiffs" :labels="false"
              :color="{checked: '#4b7cc4', unchecked: '#222'}"
              @change="showDiffs = !showDiffs")

</template>

<script lang="ts">
const i18n = {
  messages: {
    en: {
      all: 'All',
      colors: 'Colors',
      loading: 'Loading',
      selectColumn: 'Select data column',
      timeOfDay: 'Time of day',
      bandwidths: 'Widths: 1 pixel =',
      showDiffs: 'Show Differences',
    },
    de: {
      all: 'Alle',
      colors: 'Farben',
      loading: 'Wird geladen',
      selectColumn: 'Datenspalte wählen',
      timeOfDay: 'Uhrzeit',
      bandwidths: 'Linienbreiten: 1 pixel =',
      showDiffs: 'Differenzen',
    },
  },
}
import { Vue, Component, Prop, Watch } from 'vue-property-decorator'
import { ToggleButton } from 'vue-js-toggle-button'
import Papaparse from 'papaparse'
import readBlob from 'read-blob'
import YAML from 'yaml'

import globalStore from '@/store'
import CollapsiblePanel from '@/components/CollapsiblePanel.vue'
import TimeSlider from '@/plugins/links-gl/TimeSlider.vue'
import ConfigPanel from './ConfigPanel.vue'
import LinkGlLayer from './LinkLayer'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import DrawingTool from '@/components/DrawingTool/DrawingTool.vue'
import ZoomButtons from '@/components/ZoomButtons.vue'
import GzipFetcher from '@/workers/GzipFetcher.worker.ts?worker'

import {
  ColorScheme,
  FileSystem,
  LegendItem,
  LegendItemType,
  FileSystemConfig,
  VisualizationPlugin,
  LIGHT_MODE,
  DARK_MODE,
  Status,
  REACT_VIEW_HANDLES,
} from '@/Globals'

interface CSV {
  header: string[]
  headerMax: number[]
  rows: Float32Array
  activeColumn: number
}

@Component({
  i18n,
  components: {
    CollapsiblePanel,
    ConfigPanel,
    DrawingTool,
    LinkGlLayer,
    TimeSlider,
    ToggleButton,
    ZoomButtons,
  } as any,
})
class MyPlugin extends Vue {
  @Prop({ required: true })
  private root!: string

  @Prop({ required: true })
  private subfolder!: string

  @Prop({ required: false })
  private yamlConfig!: string

  @Prop({ required: false })
  private config!: any

  @Prop({ required: false })
  private thumbnail!: boolean

  // store ALL the columns here, we'll just pass a reference to one column each to the view
  private buildColumnValues: Float32Array[] = []
  private baseColumnValues: Float32Array[] = []

  private isButtonActiveColumn = false

  private linkLayerId = Math.random()

  private scaleWidth = 0

  private showDiffs = false
  private showTimeRange = false

  private geojsonData: any[] = []

  private selectedColorRamp = 'viridis'

  private vizDetails = {
    title: '',
    description: '',
    csvFile: '',
    csvBase: '',
    useSlider: false,
    shpFile: '',
    dbfFile: '',
    geojsonFile: '',
    projection: '',
    widthFactor: null as any,
    thumbnail: '',
    sum: false,
  }

  public myState = {
    statusMessage: '',
    fileApi: undefined as HTTPFileSystem | undefined,
    fileSystem: undefined as FileSystemConfig | undefined,
    subfolder: '',
    yamlConfig: '',
    thumbnail: false,
  }

  private csvData: CSV = { header: [], headerMax: [], rows: new Float32Array(), activeColumn: -1 }
  private csvBase: CSV = { header: [], headerMax: [], rows: new Float32Array(), activeColumn: -1 }

  private buildData: Float32Array = new Float32Array()
  private baseData: Float32Array = new Float32Array()

  private linkOffsetLookup: { [id: string]: number } = {}
  private numLinks = 0

  private isDarkMode = this.$store.state.colorScheme === ColorScheme.DarkMode
  private isLoaded = false

  private get mapProps() {
    return {
      geojson: this.geojsonData,
      buildData: this.buildData,
      baseData: this.baseData,
      showDiffs: this.showDiffs,
      colors: this.selectedColorRamp,
      scaleWidth: this.scaleWidth,
      dark: this.isDarkMode,
      build: this.csvData,
    }
  }

  public buildFileApi() {
    const filesystem = this.getFileSystem(this.root)
    this.myState.fileApi = new HTTPFileSystem(filesystem)
    this.myState.fileSystem = filesystem
  }

  private thumbnailUrl = "url('assets/thumbnail.jpg') no-repeat;"
  private get urlThumbnail() {
    return this.thumbnailUrl
  }

  private getFileSystem(name: string) {
    const svnProject: FileSystemConfig[] = this.$store.state.svnProjects.filter(
      (a: FileSystemConfig) => a.slug === name
    )
    if (svnProject.length === 0) {
      console.log('no such project')
      throw Error
    }
    return svnProject[0]
  }

  private async getVizDetails() {
    if (!this.myState.fileApi) return

    if (this.config) {
      this.vizDetails = Object.assign({}, this.config)
      return
    }

    // first get config
    try {
      // might be a project config:
      const filename =
        this.myState.yamlConfig.indexOf('/') > -1
          ? this.myState.yamlConfig
          : this.myState.subfolder + '/' + this.myState.yamlConfig

      const text = await this.myState.fileApi.getFileText(filename)
      this.vizDetails = YAML.parse(text)
    } catch (err) {
      console.error('failed')
      const e = err as any
      // maybe it failed because password?
      if (this.myState.fileSystem && this.myState.fileSystem.needPassword && e.status === 401) {
        this.$store.commit('requestLogin', this.myState.fileSystem.slug)
      }
    }
    const t = this.vizDetails.title ? this.vizDetails.title : 'Network Links'
    this.$emit('title', t)
  }

  private async buildThumbnail() {
    if (!this.myState.fileApi) return

    if (this.thumbnail && this.vizDetails.thumbnail) {
      try {
        const blob = await this.myState.fileApi.getFileBlob(
          this.myState.subfolder + '/' + this.vizDetails.thumbnail
        )
        const buffer = await readBlob.arraybuffer(blob)
        const base64 = this.arrayBufferToBase64(buffer)
        if (base64)
          this.thumbnailUrl = `center / cover no-repeat url(data:image/png;base64,${base64})`
      } catch (e) {
        console.error(e)
      }
    }
  }

  @Watch('$store.state.viewState') viewMoved() {
    if (!REACT_VIEW_HANDLES[this.linkLayerId]) return
    REACT_VIEW_HANDLES[this.linkLayerId]()
  }

  @Watch('$store.state.colorScheme') private swapTheme() {
    this.isDarkMode = this.$store.state.colorScheme === ColorScheme.DarkMode
  }

  private arrayBufferToBase64(buffer: any) {
    var binary = ''
    var bytes = new Uint8Array(buffer)
    var len = bytes.byteLength
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }

  private get buttonTitle() {
    if (this.csvData.activeColumn === -1) return 'Loading...'
    return this.csvData.header[this.csvData.activeColumn]
  }

  private clickedColorRamp(color: string) {
    this.selectedColorRamp = color
  }

  private handleScaleWidthChanged(value: number) {
    this.scaleWidth = value
  }

  private handleNewDataColumn(title: string) {
    console.log('handling column:', title)
    const column = this.csvData.header.indexOf(title)
    if (column === -1) return

    // // find max value for scaling
    if (!this.csvData.headerMax[column]) {
      let max = 0
      this.buildColumnValues[column].forEach((value) => (max = Math.max(max, value)))
      if (max) this.csvData.headerMax[column] = max
    }

    this.buildData = this.buildColumnValues[column]
    this.baseData = this.baseColumnValues[column]

    this.csvData.activeColumn = column
    this.isButtonActiveColumn = false
  }

  private async setMapCenter(data: any[]) {
    let samples = 0
    let longitude = 0
    let latitude = 0
    let gap = Math.floor(data.length / 512)

    for (let i = 0; i < data.length; i += gap) {
      longitude += data[i][1][0]
      latitude += data[i][1][1]
      samples++
    }

    longitude = longitude / samples
    latitude = latitude / samples

    this.$store.commit('setMapCamera', {
      longitude,
      latitude,
      bearing: 0,
      pitch: 0,
      zoom: 7,
      jump: true,
    })
  }

  private async mounted() {
    this.$store.commit('setFullScreen', !this.thumbnail)

    this.myState.thumbnail = this.thumbnail
    this.myState.yamlConfig = this.yamlConfig
    this.myState.subfolder = this.subfolder

    this.buildFileApi()

    await this.getVizDetails()

    // default width is 250, why not
    this.scaleWidth = this.vizDetails.widthFactor === undefined ? 250 : this.vizDetails.widthFactor

    if (this.thumbnail) {
      this.buildThumbnail()
      return
    }

    this.myState.statusMessage = 'Dateien laden...'

    // load network fully, first. Callback will then load CSVs later.
    this.loadGeojsonFeatures()
  }

  private geoJsonNetworkIsLoaded(allLinks: any[]) {
    this.geojsonData = allLinks
    this.isLoaded = true

    // runs in background
    this.setMapCenter(allLinks)

    this.myState.statusMessage = ''

    // then load CSVs in background
    this.loadCSVFiles()
  }

  private async loadGeojsonFeatures() {
    if (!this.myState.fileApi) return

    try {
      this.myState.statusMessage = 'Loading network...'
      this.linkOffsetLookup = {}
      this.numLinks = 0

      const network = `/${this.myState.subfolder}/${this.vizDetails.geojsonFile}`

      const worker = new GzipFetcher() as Worker

      worker.onmessage = (buffer: MessageEvent) => {
        if (buffer.data.error) {
          this.myState.statusMessage = buffer.data.error
          this.$store.commit('setStatus', {
            type: Status.ERROR,
            msg: `Error loading: ${network}`,
          })
        }

        const buf = buffer.data
        const decoder = new TextDecoder('utf-8')
        const jsonData = decoder.decode(buf)
        const json = JSON.parse(jsonData)
        this.numLinks = json.features.length

        // super-efficient format is [ offset, coordsFrom[], coordsTo[] ]
        const linkElements: any[] = []

        for (let i = 0; i < this.numLinks; i++) {
          const feature = json.features[i]
          const link = [i, feature.geometry.coordinates[0], feature.geometry.coordinates[1]]
          linkElements.push(link)

          this.linkOffsetLookup[feature.properties.id] = i
        }
        this.geoJsonNetworkIsLoaded(linkElements)
      }

      worker.postMessage({
        filePath: network,
        fileSystem: this.myState.fileSystem,
      })
    } catch (e) {
      this.myState.statusMessage = '' + e

      this.$store.commit('setStatus', {
        type: Status.WARNING,
        msg: `Error loading geojson: ${this.myState.subfolder}/${this.vizDetails.geojsonFile}`,
      })

      return null
    }
  }

  private beforeDestroy() {
    // MUST delete the React view handle to prevent gigantic memory leak!
    delete REACT_VIEW_HANDLES[this.linkLayerId]

    this.$store.commit('setFullScreen', false)
  }

  private handleClickColumnSelector() {
    console.log('click!')
    this.isButtonActiveColumn = !this.isButtonActiveColumn
  }

  private csvFilesToLoad: string[] = []

  private loadCSVFiles() {
    this.myState.statusMessage = 'Loading CSV data...'

    // these will load sequentially and on a worker, to make things seem faster
    this.csvFilesToLoad = [this.vizDetails.csvFile]
    if (this.vizDetails.csvBase) this.csvFilesToLoad.push(this.vizDetails.csvBase)

    // start the first load. The rest will happen sequentially,
    // because papaparse will call finishedLoadingCSV() when it's done loading & parsing
    this.loadCSVFile(this.csvFilesToLoad[0])
  }

  private async finishedLoadingCSV(parsed: any) {
    const currentCSV = this.csvFilesToLoad.shift()

    console.log('FINISHED PARSING: ', currentCSV)
    this.myState.statusMessage = 'Analyzing...'

    // an array containing a separate Float32Array for each CSV column
    const allLinks: Float32Array[] = []
    const numColumns = parsed.data[0].length - (this.vizDetails.useSlider ? 0 : 1)

    for (let i = 0; i < numColumns; i++) {
      allLinks.push(new Float32Array(this.numLinks))
    }

    let globalMax = 0

    for (const link of parsed.data.splice(1)) {
      // get array offset, or skip if this link isn't in the network!
      const offset = this.linkOffsetLookup[link[0].toString()]
      if (offset === undefined) continue

      if (this.vizDetails.useSlider) {
        const entries = link.slice(1) // skip first element (contains link-id)
        const total = entries.reduce((a: number, b: number) => a + b, 0)

        globalMax = Math.max(globalMax, total)
        allLinks[0][offset] = total // total comes first
        entries.forEach((value: number, i: number) => {
          allLinks[i + 1][offset] = value
        })
      } else {
        const entries = link.slice(1) // skip first element (contains link-id)
        entries.forEach((value: number, i: number) => {
          allLinks[i][offset] = value
        })
      }
    }

    const rowZero = parsed.data[0] as string[]
    const header = rowZero.slice(1) // skip first column with link id's

    if (this.vizDetails.useSlider) header.unshift(`${this.$t('all')}`)

    //  "8 AM" is a lot narrower than "08:00:00"
    // const cleanHeaders = header.map(h => h.replace(':00:00', ''))

    const details = {
      header, // : cleanHeaders,
      headerMax: this.vizDetails.useSlider
        ? new Array(this.csvData.header.length).fill(globalMax)
        : [],
      rows: new Float32Array(),
      activeColumn: -1,
    }

    if (this.csvFilesToLoad.length) {
      // if there's still a file to load, then we just loaded build
      this.buildColumnValues = allLinks
      this.csvData = details
      this.handleNewDataColumn(this.csvData.header[0])
    } else if (this.vizDetails.csvBase) {
      // otherwise we loaded baseline
      this.baseColumnValues = allLinks
      this.csvBase = details
    } else {
      // we are ONLY loading build
      this.buildColumnValues = allLinks
      this.csvData = details
      this.handleNewDataColumn(this.csvData.header[0])
    }

    // ARE WE DONE?
    if (this.csvFilesToLoad.length) {
      this.myState.statusMessage = 'Loading CSV Baseline...'
      this.loadCSVFile(this.csvFilesToLoad[0])
    } else {
      this.myState.statusMessage = ''
      this.handleNewDataColumn(this.csvData.header[0])
    }
  }

  private loadCSVFile(filename: string) {
    if (!this.myState.fileApi) return

    const csvFilename = `${this.myState.subfolder}/${filename}`

    const worker = new GzipFetcher() as Worker
    try {
      worker.onmessage = (buffer: MessageEvent) => {
        if (buffer.data.error) {
          this.myState.statusMessage = buffer.data.error
          this.$store.commit('setStatus', {
            type: Status.ERROR,
            msg: `Error loading: ${csvFilename}`,
          })
        }
        const buf = buffer.data
        const decoder = new TextDecoder('utf-8')
        const text = decoder.decode(buf)

        Papaparse.parse(text, {
          // preview: 10000,
          header: false,
          skipEmptyLines: true,
          dynamicTyping: true,
          worker: true,
          complete: this.finishedLoadingCSV,
        })
      }

      worker.postMessage({
        filePath: csvFilename,
        fileSystem: this.myState.fileSystem,
      })
    } catch (e) {
      console.error(e)

      this.$store.commit('setStatus', {
        type: Status.WARNING,
        msg: `Error loading CSV: ${this.myState.subfolder}/${filename}`,
      })

      return { allColumns: [], header: [], headerMax: [] }
    }
  }

  private changedTimeSlider(value: any) {
    if (value.length && value.length === 1) value = value[0]

    this.handleNewDataColumn(value)
  }
}

// !register plugin!
globalStore.commit('registerPlugin', {
  kebabName: 'links-gl',
  prettyName: 'Links',
  description: 'Network link attributes',
  filePatterns: ['**/viz-gl-link*.y?(a)ml', '**/viz-link*.y?(a)ml'],
  component: MyPlugin,
} as VisualizationPlugin)

export default MyPlugin
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.link-volume-plot {
  background: url('assets/thumbnail.jpg') no-repeat;
  background-size: cover;
  min-height: $thumbnailHeight;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.link-volume-plot.hide-thumbnail {
  background: var(--bgMapPanel);
}

.plot-container {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto auto;
  pointer-events: none;
  flex: 1;
  position: relative;
}

.map-area {
  pointer-events: auto;
}

.top-panel {
  grid-column: 1 / 2;
  grid-row: 1 / 2;
  background-color: var(--bgPanel);
  margin: 0 auto auto 0;
  padding: 0.5rem 1.5rem 1rem 1.5rem;
  z-index: 5;
  box-shadow: 0px 2px 10px #22222244;
}

.bottom-panel {
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  pointer-events: auto;
  margin: auto auto 0.5rem 0.5rem;
  filter: drop-shadow(0px 2px 4px #22222233);
}

.status-message {
  margin: 0 auto 0.5rem 0;
  padding: 0.5rem 0.5rem;
  color: var(--textFancy);
  background-color: var(--bgPanel);
  font-size: 1.5rem;
  line-height: 1.8rem;
}

.right-side {
  z-index: 1;
  display: flex;
  flex-direction: row;
  margin: 0 0 auto 0;
}

.panel-items {
  display: flex;
  flex-direction: row;
  padding: 0.5rem 0.5rem;
  background-color: var(--bgPanel);
}

.panel-item {
  h3 {
    line-height: 1.7rem;
  }

  p {
    font-size: 0.9rem;
  }
}

input {
  border: none;
  background-color: var(--bgCream2);
  color: var(--bgDark);
}

.toggle {
  margin: 0.25rem 0.5rem 0.25rem 0;
}

#dropdown-menu-color-selector {
  background-color: var(--bgBold);

  p {
    color: #888;
  }
}

.panel-item {
  margin-top: 0rem;
}

.config-section {
  flex: 1;
}

.diff-section {
  margin-top: 0.7rem;
}

@media only screen and (max-width: 640px) {
  .message-pane {
    padding: 0.5rem 0.5rem;
  }
}
</style>
