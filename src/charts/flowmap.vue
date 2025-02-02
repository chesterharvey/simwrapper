<template lang="pug">
.map-layout
  flow-map-layer.map-layer(v-if="centroids.length"
    :viewId="viewId"
    :props="mapProps"
  )

</template>

<script lang="ts">
import { Vue, Component, Watch, Prop } from 'vue-property-decorator'
import * as turf from '@turf/turf'

import { FileSystemConfig, REACT_VIEW_HANDLES } from '@/Globals'
import FlowMapLayer from '@/layers/FlowMapLayer'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import DashboardDataManager from '@/js/DashboardDataManager'
// import globalStore from '@/store'

import { VuePlugin } from 'vuera'
Vue.use(VuePlugin)

@Component({ components: { FlowMapLayer } as any })
export default class VueComponent extends Vue {
  @Prop({ required: true }) fileSystemConfig!: FileSystemConfig
  @Prop({ required: true }) subfolder!: string
  @Prop({ required: true }) files!: string[]
  @Prop({ required: true }) config!: any
  @Prop({ required: true }) datamanager!: DashboardDataManager

  private fileApi!: HTTPFileSystem
  private boundaries: any[] = []

  private centroids: { id: any; name?: any; lat: number; lon: number }[] = []
  private flows: any[] = []

  private viewId = Math.random()

  private get mapProps() {
    return {
      locations: this.centroids,
      flows: this.flows,
      dark: this.$store.state.isDarkMode,
      elapsed: this.elapsed,
    }
  }

  @Watch('$store.state.viewState') viewMoved() {
    if (!REACT_VIEW_HANDLES[this.viewId]) return
    REACT_VIEW_HANDLES[this.viewId]()
  }

  private async mounted() {
    this.fileApi = new HTTPFileSystem(this.fileSystemConfig)

    // load the boundaries and the dataset, use promises so we can clear
    // the spinner when things are finished.  MUST be in this order
    // or the flowmap gets sad if dataset loads faster than boundaries do.
    await this.loadBoundaries()
    await this.loadDataset()

    this.updateChart()

    this.$emit('isLoaded')

    this.animate()
  }

  private beforeDestroy() {
    if (this.animator) window.cancelAnimationFrame(this.animator)

    // MUST delete the React view handle to prevent gigantic memory leak!
    delete REACT_VIEW_HANDLES[this.viewId]
  }

  private startTime = Date.now()
  private elapsed = 0
  private animator: any = null

  private animate() {
    setTimeout(() => {
      this.elapsed = (Date.now() - this.startTime) * 0.05
      this.animator = window.requestAnimationFrame(this.animate)
    }, 33)
  }

  private async loadBoundaries() {
    if (!this.config.boundaries) return

    try {
      if (this.config.boundaries.startsWith('http')) {
        const boundaries = await fetch(this.config.boundaries).then(async (r) => await r.json())
        this.boundaries = boundaries.features
      } else {
        const boundaries = await this.fileApi.getFileJson(
          `${this.subfolder}/${this.config.boundaries}`
        )
        this.boundaries = boundaries.features
      }
    } catch (e) {
      console.error(e)
      return
    }
    this.calculateCentroids()
  }

  private calculateCentroids() {
    for (const feature of this.boundaries) {
      const centroid: any = turf.centerOfMass(feature as any)
      if (feature.properties[this.config.boundariesLabel]) {
        centroid.properties.label = feature.properties[this.config.boundariesLabel]
      }
      centroid.properties.id = feature.properties[this.config.boundariesJoinCol]

      this.centroids.push({
        id: `${centroid.properties.id}`,
        lon: centroid.geometry.coordinates[0],
        lat: centroid.geometry.coordinates[1],
      })
    }
    console.log({ centroids: this.centroids })
    // for (const c of this.centroids) console.log(`${c.id},${c.lon},${c.lat}`)
  }

  private async loadDataset() {
    try {
      const dataset = await this.datamanager.getDataset(this.config)
      // this.datamanager.addFilterListener(this.config, this.handleFilterChanged)

      const data = dataset.allRows || []

      // assumes flow data has "origin,destination,count" columns
      this.flows = data.map((row: any) => {
        return {
          o: `${row.origin}`,
          d: `${row.destination}`,
          v: row.count,
        }
      })
    } catch (e) {
      const message = '' + e
      console.log(message)
      this.flows = []
    }
    console.log({ flows: this.flows })
  }

  private updateChart() {
    // nothing, for now
  }
}
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.map-layout {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
}

.map-layer {
  flex: 1;
}

@media only screen and (max-width: 640px) {
}
</style>
