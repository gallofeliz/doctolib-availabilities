<template>
  <div v-if="checks" class="container-fluid">

    <p><button @click="showAddEditModal()" class="btn-primary mb-4 btn">Add check</button></p>

      <p>
        <label><input type="checkbox" :checked="allSelected" @click="selectOrUnselectToogle" /> (Un)Select All</label>
        and
        <button @click="setEnableSelected(true)" class="btn-primary btn btn-sm">Enable</button>
        or
        <button @click="setEnableSelected(false)" class="btn-primary btn btn-sm">Disable</button>
      </p>

      <b-table striped hover :items="checks" :fields="[{ key: 'select', label: '' }, 'id', 'status', 'code', { key: 'actions', label: 'Actions' }]" :sort-by="'enabled'" :sort-desc="true">

        <template #cell(select)="row">
            <input type="checkbox" v-model="selected[row.item.id]" />
        </template>

        <template #cell(status)="row">
            <span v-if="!row.item.enabled" class="badge badge-secondary">
                disabled
            </span>
            <span v-else class="badge badge-primary">
                Enabled
            </span>
        </template>

        <template #cell(code)="row">
            {{ row.item }}
        </template>

        <template #cell(actions)="row">
          <b-button size="sm" class="mr-2" @click="showAddEditModal(row.item.id)">
            Edit
          </b-button>
        </template>

      </b-table>

      <p>Last Error</p>

      <img src="/api/last-error-snapshot" />

    <b-modal ref="addEditModal" :title="addEditModalData.id ? 'Edit check' : 'Add check'" size="xl" scrollable>
      <div class="d-block">

        <p><label>Check source</label></p>
        <textarea v-model="addEditModalData.code"></textarea>

        <p>You can add weekDays (ex ['mon', ...]), wantedBefore can be a number or a date.</p>
        <p>You can use full Url (Direct link to calendar) or keys alreadySeen, teleHealth, motiveCat, motive.</p>
        <p>For Hapicare, use url "https://www.hapicare.fr/rest//public/agenda/doctor/availability/?doctorId=xxx&endDate=1667088000000&nbrOfDays=4&reasonId=702&siteId=10&startDate=1666742400000"</p>
      </div>
      <template #modal-footer>
        <div>
          <b-button size="sm" class="mr-2" @click="addEditModalTest()">
            Test<span v-if="addEditModalData.testing"> (running...)</span>
          </b-button>
          <b-button size="sm" class="mr-2" variant="primary" @click="addEditModalSave()">
            Save
          </b-button>
        </div>
      </template>
    </b-modal>

  </div>
</template>

<script>

export default {
  name: 'Home',
  data() {
    return {
        checks: null,
        addEditModalData: {},
        selected: {}
    }
  },
  created() {
    this.loadChecks()
  },
  computed: {
    allSelected() {
      for (const id in this.selected) {
        if (!this.selected[id]) {
          return false
        }
      }
      return true
    }
  },
  methods: {
    async loadChecks() {
        this.checks = await (await fetch('/api/checks')).json()
        this.selected = this.checks.reduce((selected, check) => ({...selected, [check.id]: false}), {})
    },
    selectOrUnselectToogle() {
      if (this.allSelected) {
        this.selectOrUnselectAll(false)
      } else {
        this.selectOrUnselectAll(true)
      }
    },
    selectOrUnselectAll(value) {
      for (const id in this.selected) {
        this.selected[id] = value
      }
    },
    showAddEditModal(id) {
        this.addEditModalData = {
            id,
            code: id
                ? JSON.stringify(this.checks.find(check => check.id === id), undefined, 2)
                : JSON.stringify({id: '', url: '', wantedBefore: 14, enabled: true}, undefined, 2),
            testing: false
        }
        this.$refs['addEditModal'].show()
    },
    async setEnableSelected(value) {
      const selectedIds = Object.keys(this.selected).filter(id => this.selected[id])

      if (!selectedIds.length) {
        return
      }

      const res = await fetch('/api/batch/checks?ids=' + selectedIds.map(v => encodeURIComponent(v)).join('&ids='), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({enabled: value})
      })

      if (!res.ok) {
        throw new Error('Failed fetch')
      }

      this.loadChecks()
    },
    async addEditModalSave() {
        const source = JSON.parse(this.addEditModalData.code)

        const res = this.addEditModalData.id
        ? await fetch('/api/checks/' + encodeURIComponent(this.addEditModalData.id), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(source)
        })
        : await fetch('/api/checks', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(source)
        })

        if (!res.ok) {
            throw new Error('Failed fetch')
        }

        this.$refs['addEditModal'].hide()
        this.loadChecks()
    },
    async addEditModalTest() {
        const source = JSON.parse(this.addEditModalData.code)
        this.addEditModalData.testing = true
        const res = await fetch('/api/debug/check', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(source)
        })
        this.addEditModalData.testing = false

        const value = await res.json()

        if (!value.success) {
            alert('Error : ' + JSON.stringify(value.error))
        } else {
            if (!value.newValue) {
                alert('No error but no availabilities ; can be normal or misconfiguration')
            } else {
                alert('Oh yeah you have already availabilities !!! ' + JSON.stringify(value.newValue))
            }
        }
    }
  }
}
</script>
<style scoped>
textarea {
    width: 100%;
    min-height: 150px;
}
</style>
