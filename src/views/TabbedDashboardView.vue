<template lang="pug">
.tabbed-folder-view

  .tabholder(v-show="!isZoomed")
    .tabholdercontainer
      .breadcrumbs
        h3 {{ xsubfolder.substring(1+xsubfolder.lastIndexOf('/')) }}
        h4 {{ root }}: {{ xsubfolder && xsubfolder.startsWith('/') ? '' : '/' }}{{ xsubfolder }}

      .tabs.is-centered
        ul
          li(v-for="tab in Object.keys(dashboards)" :key="tab"
            :class="{'is-active': tab===activeTab, 'is-not-active': tab!==activeTab}"
            :style="{opacity: tab===activeTab ? 1.0 : 0.5}"
          )
            b: a(@click="switchTab(tab)") {{ dashboards[tab].header.tab }}


  dash-board(v-if="activeTab && activeTab !== 'FILE__BROWSER' && dashboards[activeTab].header.tab !== '...'"
    :root="root"
    :xsubfolder="xsubfolder"
    :config="dashboards[activeTab]"
    :datamanager="dashboardDataManager"
    :zoomed="isZoomed"
    :allConfigFiles="allConfigFiles"
    @zoom="handleZoom"
  )

  folder-browser(v-if="activeTab && activeTab === 'FILE__BROWSER'"
    :root="root"
    :xsubfolder="xsubfolder"
    :allConfigFiles="allConfigFiles"
    @navigate="onNavigate"
  )

</template>

<script lang="ts">
import { Vue, Component, Watch, Prop } from 'vue-property-decorator'
import YAML from 'yaml'

import { FileSystemConfig, YamlConfigs } from '@/Globals'
import DashBoard from '@/views/DashBoard.vue'
import FolderBrowser from '@/views/FolderBrowser.vue'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import DashboardDataManager from '@/js/DashboardDataManager'

@Component({ components: { DashBoard, FolderBrowser }, props: {} })
export default class VueComponent extends Vue {
  @Prop({ required: true }) private root!: string
  @Prop({ required: false }) private xsubfolder!: string

  private activeTab = ''
  private fileSystemConfig!: FileSystemConfig
  private fileApi!: HTTPFileSystem

  private dashboards: any = []
  private dashboardDataManager?: DashboardDataManager

  private allConfigFiles!: YamlConfigs

  private isZoomed = false

  private mounted() {
    this.updateRoute()
  }

  private beforeDestroy() {
    if (this.dashboardDataManager) this.dashboardDataManager.clearCache()
  }

  @Watch('root')
  @Watch('xsubfolder')
  private updateRoute() {
    this.fileSystemConfig = this.getFileSystem(this.root)
    if (!this.fileSystemConfig) return

    if (this.dashboardDataManager) this.dashboardDataManager.clearCache()
    this.dashboardDataManager = new DashboardDataManager(this.root, this.xsubfolder)

    this.fileApi = new HTTPFileSystem(this.fileSystemConfig)

    // this.generateBreadcrumbs()

    // this happens async
    this.dashboards = []
    this.findDashboards()
  }

  private onNavigate(options: any) {
    this.$emit('navigate', options)
  }

  private async findDashboards() {
    if (!this.fileApi) return []

    try {
      this.allConfigFiles = await this.fileApi.findAllYamlConfigs(this.xsubfolder)

      for (const fullPath of Object.values(this.allConfigFiles.dashboards)) {
        // add the tab now
        Vue.set(this.dashboards, fullPath, { header: { tab: '...' } })
        // load the details (title) async
        this.initDashboard(fullPath)
      }

      // Add FileBrowser as "Files" tab
      Vue.set(this.dashboards, 'FILE__BROWSER', { header: { tab: 'Files' } })

      // // Start on first tab
      this.activeTab = Object.keys(this.dashboards)[0]
    } catch (e) {
      // Bad things happened! Tell user
      console.error({ eeee: e })
    }
  }

  // for each dashboard, fetch the yaml, set the tab title, and config the ... switcher?
  private async initDashboard(fullPath: string) {
    const config = await this.fileApi.getFileText(fullPath)
    const yaml = YAML.parse(config)
    const shortFilename = fullPath.substring(0, fullPath.lastIndexOf('.'))
    if (!yaml.header) yaml.header = { title: fullPath, tab: shortFilename }
    if (!yaml.header.tab) yaml.header.tab = yaml.header.title || shortFilename

    this.dashboards[fullPath] = yaml
    console.log('DASHBOARD:', fullPath)
  }

  private async switchTab(tab: string) {
    if (tab === this.activeTab) return

    // Force teardown the dashboard to ensure we start with a clean slate
    this.activeTab = ''
    await this.$nextTick()
    this.activeTab = tab
  }

  private handleZoom(isZoomed: any) {
    this.isZoomed = !!isZoomed
    this.$emit('zoom', this.isZoomed)
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
}
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.tabbed-folder-view {
  margin: 0 0;
  padding: 0 0;
  background-color: var(--bgDashboard);
  flex-direction: column;
  overflow-y: auto;
}

.tabs {
  margin: 0 0rem;
}

.tabs ul {
  border-bottom-color: var(--bg);
  border-bottom-width: 1px;
}

.tabholder {
  max-width: $dashboardWidth + 3;
  margin: 0 auto;
  z-index: 5;
  top: 0px;
  position: sticky;
  background-color: var(--bgDashboard);
}

.tabholdercontainer {
  background-image: var(--bgDashboard);
  // background-image: var(--bgTabBanner);
  margin: 0 3rem;
}

// li.is-active b a {
//   // color: #ebff67;
//   text-transform: uppercase;
// }

li.is-not-active b a {
  color: var(--text);
  // text-transform: uppercase;
  // border-bottom-color: var(--bg);
}

.breadcrumbs {
  background-image: var(--bgTabBanner);
  padding: 0.25rem 0 1rem 1rem;
  color: var(--linkFancy);
  font-size: 1.5rem;
  text-align: center;

  h3 {
    color: white;
    font-weight: bold;
  }

  h4 {
    line-height: 1rem;
    margin: 0;
    color: #e4e4e4;
    font-size: 1.1rem;
  }

  p {
    max-width: $dashboardWidth;
    margin: 0 2rem;
  }
}

@media only screen and (max-width: 50em) {
}
</style>
