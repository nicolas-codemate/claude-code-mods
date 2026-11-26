import { expect, test } from 'claude-code/testing'

import { genericSymbolsOfFile } from './generic-outline'

function outline(path: string, lines: string[]): (string | number | null)[][] {
  return genericSymbolsOfFile(path, lines.join('\n')).map(symbol => {
    expect(symbol.path).toBe(path)

    return [symbol.name, symbol.kind, symbol.line, symbol.container]
  })
}

test('a Python class holds its methods by indentation, a docstring and a comment declaring nothing', async () => {
  expect(
    outline('shop/orders.py', [
      'MAX_ITEMS = 50',
      '',
      'class OrderRepository(Repository):',
      '    """',
      '    def not_a_method(self):',
      '    """',
      '    # def commented_out(self):',
      '    def save(self, order):',
      '        def normalized(line):',
      '            return line',
      '',
      '    async def find_by_customer(',
      '        self,',
      '        customer_id,',
      '    ):',
      '        pass',
      '',
      'def total_of(order):',
      '    return 0',
    ]),
  ).toEqual([
    ['MAX_ITEMS', 'constant', 1, null],
    ['OrderRepository', 'class', 3, null],
    ['save', 'method', 8, 'OrderRepository'],
    ['normalized', 'function', 9, 'save'],
    ['find_by_customer', 'method', 12, 'OrderRepository'],
    ['total_of', 'function', 18, null],
  ])
})

test('a Go method is held by its receiver type, a struct and an interface list as class and interface', async () => {
  expect(
    outline('shop/order.go', [
      'package shop',
      '',
      'type Order struct {',
      '\tID    string',
      '\tTotal int',
      '}',
      '',
      'type PaymentGateway interface {',
      '\tCharge(order *Order) error',
      '}',
      '',
      'type OrderID string',
      '',
      '// func Commented() {}',
      'func (order *Order) AddLine(price int) {',
      '\torder.Total += price',
      '}',
      '',
      'func NewOrder(id string) *Order {',
      '\treturn &Order{ID: id}',
      '}',
    ]),
  ).toEqual([
    ['Order', 'class', 3, null],
    ['PaymentGateway', 'interface', 8, null],
    ['Charge', 'method', 9, 'PaymentGateway'],
    ['OrderID', 'type', 12, null],
    ['AddLine', 'method', 15, 'Order'],
    ['NewOrder', 'function', 19, null],
  ])
})

test('a Rust impl block holds its functions as methods without being listed itself', async () => {
  expect(
    outline('src/order.rs', [
      'pub const MAX_LINES: usize = 50;',
      '',
      'pub struct Order {',
      '    lines: Vec<OrderLine>,',
      '}',
      '',
      'pub enum OrderStatus { Pending, Paid }',
      '',
      'pub trait Payable {',
      '    fn pay(&self) -> bool;',
      '}',
      '',
      'impl<T> Payable for Order {',
      '    fn pay(&self) -> bool {',
      '        true',
      '    }',
      '}',
      '',
      'pub(crate) async fn checkout(order: Order) {}',
      '',
      'mod tests {',
      '    fn totals_add_up() {}',
      '}',
      'type OrderId = u64;',
    ]),
  ).toEqual([
    ['MAX_LINES', 'constant', 1, null],
    ['Order', 'class', 3, null],
    ['OrderStatus', 'enum', 7, null],
    ['Payable', 'trait', 9, null],
    ['pay', 'method', 10, 'Payable'],
    ['pay', 'method', 14, 'Order'],
    ['checkout', 'function', 19, null],
    ['tests', 'class', 21, null],
    ['totals_add_up', 'function', 22, 'tests'],
    ['OrderId', 'type', 24, null],
  ])
})

test('a Java class lists its constant, constructor and methods, never a statement of a method body', async () => {
  expect(
    outline('src/main/java/shop/OrderService.java', [
      'package shop;',
      '',
      '/**',
      ' * public void documented() {',
      ' */',
      'public final class OrderService {',
      '    private static final int MAX_LINES = 50;',
      '    private final OrderRepository repository;',
      '',
      '    public OrderService(OrderRepository repository) {',
      '        this.repository = repository;',
      '    }',
      '',
      '    @Override',
      '    public List<Order> findPaid(String customerId) throws NotFound {',
      '        return repository.findAll(customerId);',
      '    }',
      '}',
      '',
      'interface Payable {',
      '    void pay(Order order);',
      '}',
      'enum OrderStatus { PENDING, PAID }',
    ]),
  ).toEqual([
    ['OrderService', 'class', 6, null],
    ['MAX_LINES', 'constant', 7, 'OrderService'],
    ['OrderService', 'method', 10, 'OrderService'],
    ['findPaid', 'method', 15, 'OrderService'],
    ['Payable', 'interface', 20, null],
    ['pay', 'method', 21, 'Payable'],
    ['OrderStatus', 'enum', 23, null],
  ])
})

test('a C# namespace holds its classes, a brace on its own line keeping the class open', async () => {
  expect(
    outline('Shop/OrderService.cs', [
      'namespace Shop.Orders',
      '{',
      '    public sealed class OrderService',
      '    {',
      '        public const int MaxLines = 50;',
      '        public decimal Total { get; private set; }',
      '',
      '        public async Task<Order> PlaceAsync(Cart cart)',
      '        {',
      '            return await repository.SaveAsync(cart);',
      '        }',
      '    }',
      '',
      '    public record OrderPlaced(string Id);',
      '}',
    ]),
  ).toEqual([
    ['Shop.Orders', 'class', 1, null],
    ['OrderService', 'class', 3, 'Shop.Orders'],
    ['MaxLines', 'constant', 5, 'OrderService'],
    ['Total', 'property', 6, 'OrderService'],
    ['PlaceAsync', 'method', 8, 'OrderService'],
    ['OrderPlaced', 'class', 14, 'Shop.Orders'],
  ])
})

test('Kotlin, Scala, Swift and Dart declare classes and functions with their own keywords', async () => {
  expect(
    outline('shop/Order.kt', [
      'const val MAX_LINES = 50',
      'data class Order(val id: String) {',
      '    fun total(): Int = 0',
      '    companion object {',
      '        fun empty() = Order("")',
      '    }',
      '}',
      'enum class OrderStatus { PENDING }',
      'fun Order.isPaid(): Boolean = false',
      'typealias OrderId = String',
    ]),
  ).toEqual([
    ['MAX_LINES', 'constant', 1, null],
    ['Order', 'class', 2, null],
    ['total', 'method', 3, 'Order'],
    ['empty', 'method', 5, 'Order'],
    ['OrderStatus', 'enum', 8, null],
    ['isPaid', 'function', 9, null],
    ['OrderId', 'type', 10, null],
  ])
  expect(
    outline('shop/Order.scala', [
      'sealed trait Payable',
      'case class Order(id: String) extends Payable {',
      '  def total: Int = 0',
      '}',
      'object Order {',
      '  def empty(): Order = Order("")',
      '}',
    ]),
  ).toEqual([
    ['Payable', 'trait', 1, null],
    ['Order', 'class', 2, null],
    ['total', 'method', 3, 'Order'],
    ['Order', 'class', 5, null],
    ['empty', 'method', 6, 'Order'],
  ])
  expect(
    outline('Shop/Order.swift', [
      'protocol Payable {',
      '    func pay() -> Bool',
      '}',
      'final class Order: Payable {',
      '    init(id: String) {}',
      '    class func empty() -> Order { Order(id: "") }',
      '    func pay() -> Bool { true }',
      '}',
      'extension Order {',
      '    private func audit() {}',
      '}',
      'struct OrderLine {}',
    ]),
  ).toEqual([
    ['Payable', 'interface', 1, null],
    ['pay', 'method', 2, 'Payable'],
    ['Order', 'class', 4, null],
    ['init', 'method', 5, 'Order'],
    ['empty', 'method', 6, 'Order'],
    ['pay', 'method', 7, 'Order'],
    ['Order', 'class', 9, null],
    ['audit', 'method', 10, 'Order'],
    ['OrderLine', 'class', 12, null],
  ])
  expect(
    outline('lib/order.dart', [
      'const maxLines = 50;',
      'abstract class Order {',
      '  Order(this.id);',
      '  int get total => 0;',
      '  Future<void> pay(PaymentGateway gateway) async {',
      '    await gateway.charge(this);',
      '  }',
      '}',
      'mixin Auditable {}',
      'void main() {',
      '  runApp(const ShopApp());',
      '}',
    ]),
  ).toEqual([
    ['maxLines', 'constant', 1, null],
    ['Order', 'class', 2, null],
    ['total', 'method', 4, 'Order'],
    ['pay', 'method', 5, 'Order'],
    ['Auditable', 'trait', 9, null],
    ['main', 'function', 10, null],
  ])
})

test('a C or C++ function is a definition at the start of its line, a prototype or a forward declaration is not', async () => {
  expect(
    outline('src/order.h', [
      '#ifndef ORDER_H',
      'struct order;',
      'int order_total(const struct order *order);',
      '',
      'typedef struct order_line {',
      '    int price;',
      '} order_line;',
      '',
      'enum order_status { PENDING, PAID };',
      '',
      'static int order_count(struct order *order)',
      '{',
      '    return 0;',
      '}',
    ]),
  ).toEqual([
    ['order_line', 'class', 5, null],
    ['order_status', 'enum', 9, null],
    ['order_count', 'function', 11, null],
  ])
  expect(
    outline('src/OrderService.cpp', [
      'namespace shop {',
      'class OrderService : public Service {',
      'public:',
      '    explicit OrderService(Repository &repository);',
      '    virtual Order place(const Cart &cart) const;',
      'private:',
      '    int count_;',
      '};',
      '',
      'Order OrderService::place(const Cart &cart) const {',
      '    if (cart.empty()) {',
      '        return Order();',
      '    }',
      '}',
      'OrderService::OrderService(Repository &repository) : repository_(repository) {}',
      '}',
    ]),
  ).toEqual([
    ['shop', 'class', 1, null],
    ['OrderService', 'class', 2, null],
    ['OrderService', 'method', 4, 'OrderService'],
    ['place', 'method', 5, 'OrderService'],
    ['place', 'method', 10, 'OrderService'],
    ['OrderService', 'method', 15, 'OrderService'],
  ])
})

test('Ruby, Elixir, Lua, shell and Perl declare modules and functions', async () => {
  expect(
    outline('app/models/order.rb', [
      'module Shop',
      '  class Order < ApplicationRecord',
      '    MAX_LINES = 50',
      '    def self.pending',
      '    end',
      '',
      '    def paid?',
      '    end',
      '  end',
      'end',
    ]),
  ).toEqual([
    ['Shop', 'class', 1, null],
    ['Order', 'class', 2, 'Shop'],
    ['MAX_LINES', 'constant', 3, 'Order'],
    ['pending', 'method', 4, 'Order'],
    ['paid?', 'method', 7, 'Order'],
  ])
  expect(
    outline('lib/shop/order.ex', [
      'defmodule Shop.Order do',
      '  @moduledoc """',
      '  def documented, do: nil',
      '  """',
      '  @type t :: %__MODULE__{}',
      '  def total(order), do: order.total',
      '  defp round_price(price), do: price',
      'end',
    ]),
  ).toEqual([
    ['Shop.Order', 'class', 1, null],
    ['t', 'type', 5, 'Shop.Order'],
    ['total', 'function', 6, 'Shop.Order'],
    ['round_price', 'function', 7, 'Shop.Order'],
  ])
  expect(
    outline('shop/cart.lua', [
      '--[[',
      'function commented() end',
      ']]',
      'local Cart = {}',
      'function Cart:add(item)',
      'end',
      'Cart.clear = function(self) end',
      'local function total(cart)',
      'end',
    ]),
  ).toEqual([
    ['add', 'method', 5, 'Cart'],
    ['clear', 'method', 7, 'Cart'],
    ['total', 'function', 8, null],
  ])
  expect(
    outline('bin/deploy.sh', ['#!/bin/sh', '# build() {', 'build() {', '  make', '}', 'function publish_orders {', '}']),
  ).toEqual([
    ['build', 'function', 3, null],
    ['publish_orders', 'function', 6, null],
  ])
  expect(outline('lib/Shop/Order.pm', ['package Shop::Order;', 'sub total {', '}'])).toEqual([
    ['Shop::Order', 'class', 1, null],
    ['total', 'function', 2, null],
  ])
})

test('Markdown headings nest by level, a heading inside a fenced block or the front matter is not one', async () => {
  expect(
    outline('docs/orders.md', [
      '---',
      '# title: front matter',
      '---',
      '# Orders',
      '',
      '## Placing an order',
      '',
      '```sh',
      '# not a heading',
      '```',
      '',
      '### Payment',
      '',
      'Refunds',
      '-------',
      '',
      '    # indented code',
      '# Shipping #',
    ]),
  ).toEqual([
    ['Orders', 'section', 4, null],
    ['Placing an order', 'section', 6, 'Orders'],
    ['Payment', 'section', 12, 'Placing an order'],
    ['Refunds', 'section', 14, 'Orders'],
    ['Shipping', 'section', 18, null],
  ])
  expect(outline('docs/orders.adoc', ['= Orders', '----', '== not a heading', '----', '== Payment'])).toEqual([
    ['Orders', 'section', 1, null],
    ['Payment', 'section', 5, 'Orders'],
  ])
})

test('YAML lists the root keys and the first level under them, never a list item or a multi-line string', async () => {
  expect(
    outline('config/shop.yaml', [
      '# shop configuration',
      'orders:',
      '  max_lines: 50',
      '  statuses:',
      '    - pending',
      '    - paid',
      '  description: |',
      '    refund: not a key',
      '  "currency": EUR',
      'payment:',
      '  - provider: stripe',
      '    mode: test',
      'url: https://shop.example',
    ]),
  ).toEqual([
    ['orders', 'section', 2, null],
    ['max_lines', 'section', 3, 'orders'],
    ['statuses', 'section', 4, 'orders'],
    ['description', 'section', 7, 'orders'],
    ['currency', 'section', 9, 'orders'],
    ['payment', 'section', 10, null],
    ['url', 'section', 13, null],
  ])
})

test('TOML and INI list their sections, a dotted table held by its parent table', async () => {
  expect(
    outline('pyproject.toml', [
      '[project]',
      'name = "shop"',
      'description = """',
      '[not.a.section]',
      '"""',
      '[project.scripts]',
      'tags = [',
      '  "orders",',
      ']',
      '[[tool.shop.gateways]]',
    ]),
  ).toEqual([
    ['project', 'section', 1, null],
    ['project.scripts', 'section', 6, 'project'],
    ['tool.shop.gateways', 'section', 10, null],
  ])
  expect(outline('config/shop.ini', ['; orders', '[orders]', 'max = 50', '[payment]'])).toEqual([
    ['orders', 'section', 2, null],
    ['payment', 'section', 4, null],
  ])
})

test('JSON lists the keys of the root object and of the objects it holds, not the keys of a list', async () => {
  expect(
    outline('package.json', [
      '{',
      '  // shop package',
      '  "name": "shop",',
      '  "scripts": {',
      '    "build": "tsc",',
      '    "nested": { "deep": true }',
      '  },',
      '  "orders": [{ "id": 1 }],',
      '  "description": "a: \\"quoted\\" value"',
      '}',
    ]),
  ).toEqual([
    ['name', 'section', 3, null],
    ['scripts', 'section', 4, null],
    ['build', 'section', 5, 'scripts'],
    ['nested', 'section', 6, 'scripts'],
    ['orders', 'section', 8, null],
    ['description', 'section', 9, null],
  ])
})

test('a stylesheet lists its rules and at-rules, and the rules nested one level in them', async () => {
  expect(
    outline('assets/shop.css', [
      '/* .commented { } */',
      '.order-list,',
      '.order-grid {',
      '  background: url("data:image/png;base64,AAA{");',
      '}',
      '@media (max-width: 600px) {',
      '  .order-list { display: block; }',
      '}',
      '@keyframes pulse {',
      '  from { opacity: 0; }',
      '}',
    ]),
  ).toEqual([
    ['.order-list, .order-grid', 'section', 2, null],
    ['@media (max-width: 600px)', 'section', 6, null],
    ['.order-list', 'section', 7, '@media (max-width: 600px)'],
    ['@keyframes pulse', 'section', 9, null],
  ])
  expect(
    outline('assets/cart.scss', ['$gap: 4px;', '// .commented {', '.cart {', '  color: red;', '  &__line { margin: #{$gap}; }', '  .price { .currency { } }', '}']),
  ).toEqual([
    ['.cart', 'section', 3, null],
    ['&__line', 'section', 5, '.cart'],
    ['.price', 'section', 6, '.cart'],
  ])
})

test('SQL lists what a CREATE statement creates, by the kind of object', async () => {
  expect(
    outline('migrations/001_orders.sql', [
      '-- CREATE TABLE commented (id int);',
      'CREATE TABLE IF NOT EXISTS "orders" (',
      '  id serial',
      ');',
      'create unique index orders_reference on orders (reference);',
      'CREATE OR REPLACE FUNCTION shop.order_total(order_id int) RETURNS int AS $$',
      'CREATE MATERIALIZED VIEW paid_orders AS SELECT 1;',
      '/*',
      'CREATE TABLE inside_comment (id int);',
      '*/',
    ]),
  ).toEqual([
    ['orders', 'class', 2, null],
    ['orders_reference', 'section', 5, null],
    ['shop.order_total', 'function', 6, null],
    ['paid_orders', 'class', 7, null],
  ])
})

test('a Makefile lists its targets, never a variable or a special target', async () => {
  expect(
    outline('Makefile', [
      'BUILD_DIR := build',
      'URL = http://shop.example',
      'PREFIX ::= /usr',
      '.PHONY: build test',
      'build test: deps',
      '\t$(MAKE) -C src all:',
      '%.o: %.c',
      'define HELP',
      'help: not a target',
      'endef',
      'clean::',
    ]),
  ).toEqual([
    ['build', 'section', 5, null],
    ['test', 'section', 5, null],
    ['%.o', 'section', 7, null],
    ['clean', 'section', 11, null],
  ])
})

test('a Dockerfile lists its stages, named after their alias or their image', async () => {
  expect(
    outline('docker/Dockerfile.prod', ['FROM node:22 AS assets', 'RUN npm ci', 'from --platform=linux/amd64 php:8.4-fpm'])).toEqual([
    ['assets', 'section', 1, null],
    ['php:8.4-fpm', 'section', 3, null],
  ])
})

test('Twig and Jinja list their blocks and macros, a block nested in another held by it', async () => {
  expect(
    outline('templates/order/show.html.twig', [
      "{% extends 'base.html.twig' %}",
      "{% block title 'Order' %}",
      '{% block body %}',
      '  {%- block summary -%}{% endblock %}',
      '  {% block lines %}',
      '  {% endblock lines %}',
      '{% endblock %}',
      '{% macro price(amount) %}{% endmacro %}',
    ]),
  ).toEqual([
    ['title', 'section', 2, null],
    ['body', 'section', 3, null],
    ['summary', 'section', 4, 'body'],
    ['lines', 'section', 5, 'body'],
    ['price', 'function', 8, null],
  ])
})

test('an HTML page lists its elements carrying an id and its template blocks', async () => {
  expect(
    outline('templates/checkout.html', [
      '{% block content %}',
      '<!-- <div id="commented"> -->',
      '<form id="checkout" method="post"><button id=\'pay\'>Pay</button></form>',
      '{% endblock %}',
    ]),
  ).toEqual([
    ['content', 'section', 1, null],
    ['form#checkout', 'section', 3, null],
    ['button#pay', 'section', 3, null],
  ])
})

test('a .env file lists its keys, whatever its suffix', async () => {
  expect(outline('.env.local', ['# database', 'DATABASE_URL=postgres://shop', 'export STRIPE_KEY="sk_test"'])).toEqual([
    ['DATABASE_URL', 'section', 2, null],
    ['STRIPE_KEY', 'section', 3, null],
  ])
})

test('a file of an unknown language lists the declaration shapes most languages share, a text file nothing', async () => {
  expect(
    outline('src/order.zig', [
      '// fn commented() void {}',
      'pub const Order = struct {',
      '    pub fn total(self: Order) u32 {',
      '        return 0;',
      '    }',
      '};',
      'pub fn main() void {}',
    ]),
  ).toEqual([
    ['total', 'function', 3, null],
    ['main', 'function', 7, null],
  ])
  expect(outline('notes/orders.txt', ['class Order', 'def total'])).toEqual([])
  expect(genericSymbolsOfFile('README', '')).toEqual([])
})

test('the list stops at two thousand entries, ranked by line', async () => {
  const lines = Array.from({ length: 2500 }, (_unused, index) => `def order_${index}():`)
  const symbols = genericSymbolsOfFile('shop/many.py', lines.join('\n'))

  expect(symbols.length).toBe(2000)
  expect(symbols.at(-1)?.line).toBe(2000)
})
