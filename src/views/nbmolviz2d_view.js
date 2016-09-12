/**
 * Copyright 2016 Autodesk Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import Backbone from 'backbone';
import {
  select,
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from 'd3';
import NodesView from '../views/nodes_view';
import NodesModel from '../models/nodes_model';
import LinksModel from '../models/links_model';
import LinksView from '../views/links_view';
import molViewUtils from '../utils/mol_view_utils';

// TODO make sure root model is in sync with derivatives

const Nbmolviz2dView = Backbone.View.extend({

  tagName: 'div',

  initialize() {
    this.model.on('change', this.render.bind(this));
  },

  handleMessage(message) {
    this.messages.push(message);
    if (message.event === 'function_call') {
      this.handleFunctionCall(message);
    }
  },

  handleFunctionCall(event) {
    // TODO: handle exceptions
    // console.log('MolViz3DBaseWidget received a function call: '
    //    + event.function_name +'('+ event.arguments+')');
    // try {

    // TODO get rid of RPC altogether
    // For now, ignore this specific one and handle it by listening to the model
    if (event.function_name === 'updateHighlightAtoms') {
      return;
    }

    this.messages.push(event);
    const myFunction = this[event.function_name];
    const result = myFunction.apply(this, event.arguments);
    this.send({
      call_id: event.call_id,
      result,
      function_name: event.function_name,
      event: 'function_done',
    });
  },

  render() {
    // TODO can we remove this?
    document.last_2d_widget = this;

    // set properties
    this.graph = JSON.parse(JSON.stringify(this.model.get('graph')));

    // setup the div
    this.el.id = this.model.get('id');
    this.el.style.width = this.model.get('width');
    this.el.style.height = this.model.get('height');
    this.el.style.position = 'relative';

    // render it
    this.renderViewer();
    this.indexSvgElements();

    // set up interactions with python
    this.messages = [];
    this.highlightedAtoms = [];
    this.listenTo(this.model, 'msg:custom', this.handleMessage, this);

    if (typeof this.send === 'function') {
      this.send({ event: 'ready' });
    }

    // console.log(`${this.viewerId} is ready`);
  },

  setAtomStyle(atoms, atomSpec) {
    this.applyStyleSpec(atoms, this.svgNodes, atomSpec);
  },

  setBondStyle(bonds, bondSpec) {
    this.applyStyleSpec(bonds, this.svgLinks, bondSpec);
  },

  applyStyleSpec(objs, objLookup, spec) {
    // TODO: don't just assume children[0]
    objs.forEach((o) => {
      const obj = objLookup[o];
      if (typeof(obj) === 'undefined') {
        throw new Error(`no object ${o}`);
      }
      Object.keys(spec).forEach((st) => {
        obj.children[0].style[st] = spec[st];
      });
    });
  },

  setAtomLabel(atom, text, spec) {
    const obj = this.svgNodes[atom].children[1];
    if (typeof(text) !== 'undefined') {
      obj.innerHTML = text;
    }
    Object.keys(spec).forEach((st) => {
      obj.style[st] = spec[st];
    });
  },

  setBondLabel(bond, text, spec) {
    const link = this.svgLinks[bond];
    if (typeof(link) === 'undefined') {
      // console.log(`No bond ${bond}`);
      return;
    }
    if (typeof(text) !== 'undefined') {
      link.children[1].innerHTML = text;
    }
    Object.keys(spec).forEach((st) => {
      link.children[1].style[st] = spec[st];
    });
  },

  indexSvgElements() {
    this.svgNodes = {};
    this.svgLinks = {};
    const svgElements = this.svg._groups[0][0].children;

    for (let i = 0; i < svgElements.length; ++i) {
      const elem = svgElements[i];
      if (elem.getAttribute('class') === 'node') {
        const index = elem.getAttribute('index');
        this.svgNodes[index] = elem;
      }
      if (elem.getAttribute('class') === 'link') {
        const child = elem.children[0];
        const source = child.getAttribute('source');
        const target = child.getAttribute('target');
        this.svgLinks[[source, target]] = elem;
        this.svgLinks[[target, source]] = elem;
      }
    }
  },

  renderViewer() {
    const width = this.model.get('width');
    const height = this.model.get('height');

    if (this.el.querySelectorAll('svg').length) {
      this.svg = select(this.el).select('svg');
    } else {
      this.svg = select(this.el).append('svg');
    }

    this.svg
      .attr('width', width)
      .attr('height', height)
      .attr('border', 1);

    const simulation = forceSimulation()
      .force('link', forceLink()
        .id((d) => d.index)
        .distance((d) => molViewUtils.withDefault(d.distance, 20))
        .strength((d) => molViewUtils.withDefault(d.strength, 1.0))
      )
      .force('charge', forceManyBody())
      .force('center', forceCenter(width / 2, height / 2));

    const linksView = new LinksView({
      model: new LinksModel({
        links: this.graph.links,
      }),
      svg: this.svg,
    });
    linksView.render();

    const nodesModel = new NodesModel({
      nodes: this.graph.nodes,
      clicked_atom_index: this.model.get('clicked_atom_index'),
    });

    // TODO ideally we shouldn't duplicate data and keep it in sync, but I'm
    // afraid to touch the root model for now
    nodesModel.on('change:clicked_atom_index', () => {
      this.model.set('clicked_atom_index', nodesModel.get('clicked_atom_index'));
      this.model.save();
    });

    const nodesView = new NodesView({
      model: nodesModel,
      svg: this.svg,
      simulation,
    });
    nodesView.render();

    function ticked() {
      nodesView.renderTransform();
      linksView.renderPosition();
    }

    simulation
        .nodes(this.graph.nodes)
        .on('tick', ticked);

    simulation.force('link')
        .links(this.graph.links);
  },
});

export default Nbmolviz2dView;
