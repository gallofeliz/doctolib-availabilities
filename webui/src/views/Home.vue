<template>
  <div v-if="checks" class="container-fluid">

    <button @click="showAddEditModal()" class="btn-primary mb-4 btn">Add check</button>

      <b-table striped hover :items="checks" :fields="['id', 'status', 'code', { key: 'actions', label: 'Actions' }]">

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

      </div>
      <template #modal-footer>
        <div>
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
        addEditModalData: {}
    }
  },
  created() {
    this.loadChecks()
  },
  methods: {
    async loadChecks() {
        this.checks = await (await fetch('/api/checks')).json()
    },
    showAddEditModal(id) {
        this.addEditModalData = {
            id,
            code: id
                ? JSON.stringify(this.checks.find(check => check.id === id), undefined, 2)
                : JSON.stringify({id: '', url: '', wantedBefore: 14, enabled: true}, undefined, 2)
        }
        this.$refs['addEditModal'].show()
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
